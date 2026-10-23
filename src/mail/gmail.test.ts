import { describe, expect, test } from "bun:test";
import type { GmailAccount, GmailCursor } from "./gmail-oauth";
import { createGmailMail } from "./gmail";

const START_MS = 1_000_000;
const SENDER = "bancoficticio.example";

function makeAccount(initial: GmailCursor = { ms: START_MS, ids: [] }): {
  account: GmailAccount;
  cursor: () => GmailCursor;
  saved: GmailCursor[];
} {
  let current = { ms: initial.ms, ids: [...initial.ids] };
  const saved: GmailCursor[] = [];
  return {
    account: {
      consentUrl: (state) => `https://accounts.example.test/?state=${state}`,
      connect: async () => {},
      isConnected: () => true,
      accessToken: async () => "tok",
      cursor: () => ({ ms: current.ms, ids: [...current.ids] }),
      saveCursor: (next) => {
        current = { ms: next.ms, ids: [...next.ids] };
        saved.push({ ms: next.ms, ids: [...next.ids] });
      },
    },
    cursor: () => ({ ms: current.ms, ids: [...current.ids] }),
    saved,
  };
}

function recordedFetch(handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    requests.push({ url, init });
    return handler(url, init);
  };
  const fetch = fakeFetch as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function encoded(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fullMessage(id: string, internalDate: number, from: string, parts: object[], subject = "Estado") {
  return {
    id,
    internalDate: String(internalDate),
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
      ],
      parts,
    },
  };
}

function getId(url: URL): string {
  return decodeURIComponent(url.pathname.split("/").at(-1)!);
}

describe("createGmailMail", () => {
  test("builds the sender query, follows pages, sorts mail and advances the cursor", async () => {
    const state = makeAccount();
    const { fetch, requests } = recordedFetch((url) => {
      if (url.searchParams.has("format")) {
        const id = getId(url);
        const date = id === "newest" ? 1_010_000 : 1_005_000;
        return json(fullMessage(id, date, "Banco <avisos@bancoficticio.example>", [], id));
      }
      if (url.searchParams.get("pageToken") === "page-2") return json({ messages: [{ id: "older" }] });
      return json({ messages: [{ id: "newest" }], nextPageToken: "page-2" });
    });

    const mails = await createGmailMail({ account: state.account, fetch }).fetchNew([
      "bancoficticio.example",
      "tiendaplaza.example",
    ]);

    expect(requests[0]!.url.searchParams.get("q")).toBe(
      "from:(bancoficticio.example OR tiendaplaza.example) after:1000",
    );
    expect(requests[0]!.url.searchParams.get("maxResults")).toBe("50");
    expect(requests[1]!.url.searchParams.get("pageToken")).toBe("page-2");
    const authorizationHeaders = requests.map(({ init }) => {
      if (!init?.headers) return undefined;
      return (init.headers as Record<string, string>).Authorization;
    });
    expect(authorizationHeaders).toEqual(Array(requests.length).fill("Bearer tok"));
    expect(mails.map((mail) => mail.id)).toEqual(["older", "newest"]);
    expect(state.cursor()).toEqual({ ms: 1_010_000, ids: ["newest"] });
  });

  test("decodes plain text and html-only bodies and collects unique links", async () => {
    const state = makeAccount();
    const { fetch } = recordedFetch((url) => {
      if (!url.searchParams.has("format")) return json({ messages: [{ id: "plain" }, { id: "html" }] });
      if (getId(url) === "plain") {
        return json(
          fullMessage("plain", 1_001_000, "avisos@bancoficticio.example", [
            { mimeType: "text/plain", body: { data: encoded("Revisa https://texto.example/uno.") } },
            {
              mimeType: "text/html",
              body: {
                data: encoded('<p>Hola <a href="https://html.example/dos">abre</a></p><a href="https://texto.example/uno">repite</a>'),
              },
            },
          ]),
        );
      }
      return json(
        fullMessage("html", 1_002_000, "avisos@bancoficticio.example", [
          { mimeType: "text/html", body: { data: encoded('<p>Solo <a href="https://solo.example/tres">un enlace</a></p>') } },
        ], "HTML"),
      );
    });

    const mails = await createGmailMail({ account: state.account, fetch }).fetchNew([SENDER]);

    expect(mails[0]).toMatchObject({
      text: "Revisa https://texto.example/uno.",
      links: ["https://texto.example/uno", "https://html.example/dos"],
    });
    expect(mails[1]).toMatchObject({ text: "Solo un enlace", links: ["https://solo.example/tres"] });
  });

  test("skips ids already seen at the cursor timestamp", async () => {
    const state = makeAccount({ ms: START_MS, ids: ["seen"] });
    const { fetch } = recordedFetch((url) => {
      if (!url.searchParams.has("format")) return json({ messages: [{ id: "seen" }, { id: "fresh" }] });
      return json(fullMessage(getId(url), START_MS, "avisos@bancoficticio.example", []));
    });

    const mails = await createGmailMail({ account: state.account, fetch }).fetchNew([SENDER]);

    expect(mails.map((mail) => mail.id)).toEqual(["fresh"]);
    expect(state.cursor()).toEqual({ ms: START_MS, ids: ["fresh", "seen"] });
  });

  test("does not save the cursor when a message fetch fails and never exposes the token", async () => {
    const state = makeAccount();
    const { fetch } = recordedFetch((url) =>
      url.searchParams.has("format") ? new Response("tok https://example.test/?secret=body", { status: 500 }) : json({ messages: [{ id: "mail-1" }] }),
    );

    let error: unknown;
    try {
      await createGmailMail({ account: state.account, fetch }).fetchNew([SENDER]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("gmail: get failed (500)");
    expect((error as Error).message).not.toContain("tok");
    expect(state.saved).toEqual([]);
    expect(state.cursor()).toEqual({ ms: START_MS, ids: [] });
  });

  test("drops messages from a sender outside the requested domains", async () => {
    const state = makeAccount();
    const { fetch } = recordedFetch((url) =>
      url.searchParams.has("format")
        ? json(fullMessage("outside", 1_001_000, "avisos@lookalike-bancoficticio.example", []))
        : json({ messages: [{ id: "outside" }] }),
    );

    expect(await createGmailMail({ account: state.account, fetch }).fetchNew([SENDER])).toEqual([]);
    expect(state.cursor()).toEqual({ ms: START_MS, ids: [] });
  });

  test("does not make a request for an empty sender list", async () => {
    const state = makeAccount();
    const { fetch, requests } = recordedFetch(() => json({}));

    expect(await createGmailMail({ account: state.account, fetch }).fetchNew([])).toEqual([]);
    expect(requests).toEqual([]);
    expect(state.saved).toEqual([]);
  });
});
