import type { IncomingMail, Mail } from "../ports";
import { senderDomain } from "./senders";
import type { GmailAccount, GmailCursor } from "./gmail-oauth";

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const MAX_PAGES = 5;

type GmailMessageList = {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
};

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailPart[];
};

type GmailMessage = {
  id?: string;
  internalDate?: string;
  payload?: GmailPart;
};

type TextPart = { mimeType: string; text: string };

function textParts(payload: GmailPart | undefined): TextPart[] {
  if (!payload) return [];
  const parts: TextPart[] = [];
  const mimeType = payload.mimeType?.toLowerCase();
  const data = payload.body?.data;
  if ((mimeType === "text/plain" || mimeType === "text/html") && typeof data === "string") {
    parts.push({ mimeType, text: Buffer.from(data, "base64url").toString("utf8") });
  }
  for (const part of payload.parts ?? []) parts.push(...textParts(part));
  return parts;
}

function header(payload: GmailPart | undefined, name: string): string {
  return payload?.headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function htmlText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function urls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0]!.replace(/[.,;:!?)}\]]+$/g, ""))
    .filter(Boolean);
}

function htmlLinks(html: string): string[] {
  const links: string[] = [];
  const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(href)) links.push(...urls(match[1] ?? match[2] ?? match[3] ?? ""));
  return links;
}

function uniqueLinks(parts: TextPart[]): string[] {
  const plain = parts.find((part) => part.mimeType === "text/plain");
  const html = parts.find((part) => part.mimeType === "text/html");
  const links: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const found = part === plain ? urls(part.text) : part === html ? htmlLinks(part.text) : [];
    for (const link of found) {
      if (seen.has(link)) continue;
      seen.add(link);
      links.push(link);
    }
  }
  return links;
}

function messageMail(id: string, message: GmailMessage, receivedAt: number): IncomingMail {
  const parts = textParts(message.payload);
  const plain = parts.find((part) => part.mimeType === "text/plain");
  const html = parts.find((part) => part.mimeType === "text/html");
  return {
    id: message.id ?? id,
    from: header(message.payload, "From"),
    subject: header(message.payload, "Subject"),
    receivedAt: new Date(receivedAt),
    text: plain?.text ?? (html ? htmlText(html.text) : ""),
    links: uniqueLinks(parts),
  };
}

function nextCursor(cursor: GmailCursor, mails: IncomingMail[]): GmailCursor {
  const newest = mails.reduce((ms, mail) => Math.max(ms, mail.receivedAt.getTime()), cursor.ms);
  const ids = mails.filter((mail) => mail.receivedAt.getTime() === newest).map((mail) => mail.id);
  if (newest === cursor.ms) ids.push(...cursor.ids);
  return { ms: newest, ids: [...new Set(ids)] };
}

/** Gmail REST API adapter for Patricia's read-only inbox. */
export function createGmailMail({ account, fetch: fetchGmail = fetch }: { account: GmailAccount; fetch?: typeof fetch }): Mail {
  async function requestJson<T>(kind: "list" | "get", url: string, token: string): Promise<T> {
    let response: Response;
    try {
      response = await fetchGmail(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new Error(`gmail: ${kind} failed`);
    }
    if (!response.ok) throw new Error(`gmail: ${kind} failed (${response.status})`);
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(`gmail: ${kind} failed`);
    }
  }

  return {
    consentUrl(state) {
      return account.consentUrl(state);
    },

    connect(code) {
      return account.connect(code);
    },

    async fetchNew(senders) {
      if (senders.length === 0) return [];
      // Before her «Permitir» there is no inbox to read: nothing new, not a failure.
      if (!account.isConnected()) return [];

      const cursor = account.cursor();
      const token = await account.accessToken();
      const allowed = new Set(senders.map((sender) => sender.toLowerCase()));
      const query = `from:(${senders.join(" OR ")}) after:${Math.floor(cursor.ms / 1000)}`;
      const ids: string[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ q: query, maxResults: "50" });
        if (pageToken) params.set("pageToken", pageToken);
        const result = await requestJson<GmailMessageList>("list", `${GMAIL_MESSAGES_URL}?${params}`, token);
        for (const message of result.messages ?? []) {
          if (typeof message.id === "string") ids.push(message.id);
        }
        // Past MAX_PAGES the oldest matches are left behind; a fictional inbox never gets there.
        pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : undefined;
        if (!pageToken) break;
      }

      const mails: IncomingMail[] = [];
      for (const id of ids) {
        const url = `${GMAIL_MESSAGES_URL}/${encodeURIComponent(id)}?format=full`;
        const message = await requestJson<GmailMessage>("get", url, token);
        const internalDate = Number(message.internalDate);
        if (!Number.isFinite(internalDate) || internalDate < cursor.ms) continue;
        const mailId = message.id ?? id;
        if (internalDate === cursor.ms && cursor.ids.includes(mailId)) continue;
        const from = header(message.payload, "From");
        const domain = senderDomain(from);
        if (!domain || !allowed.has(domain)) continue;
        mails.push(messageMail(id, message, internalDate));
      }

      mails.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
      account.saveCursor(nextCursor(cursor, mails));
      return mails;
    },
  };
}
