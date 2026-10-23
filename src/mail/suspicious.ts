import type { IncomingMail } from "../ports";
import { SENDERS } from "./senders";

const SECRET_PATTERNS = [
  /\bclaves?\b/,
  /\bcontrasenas?\b/,
  /\bpins?\b/,
  /\bcvvs?\b/,
  /\bcoordenadas?\b/,
  /\bcodigos?\s+(?:de\s+verificacion|sms|de\s+seguridad|que\s+te\s+enviamos(?:\s+por\s+sms)?)\b/,
  /\bactualiza\s+tus\s+datos\b/,
  /\bconfirma\s+tus\s+datos\b/,
  /\bverifica\s+tu\s+cuenta\b/,
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** True when a link host is an allowed sender domain or one of its subdomains. */
export function isAllowedLinkHost(host: string): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.+$/, "");
  if (normalizedHost.length === 0 || normalizedHost.split(".").some((label) => label.length === 0)) return false;
  return SENDERS.some(({ domain }) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`));
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function imitatedSender(host: string): string | null {
  const sender = SENDERS.find(({ domain }) => {
    const firstLabel = domain.split(".")[0]!;
    return host.includes(firstLabel) || editDistance(host, domain) <= 2;
  });
  if (sender === undefined) return null;
  switch (sender.kind) {
    case "banco":
      return "al banco";
    case "tienda":
      return "a la tienda";
    case "catalogo":
      return "al catálogo";
  }
}

function outsideLinkReason(link: string): string {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return "El correo trae un link que no pudimos reconocer como seguro. No abrimos sus links.";
  }

  if (host.length === 0) {
    return "El correo trae un link sin un dominio reconocible. No abrimos sus links.";
  }

  const sender = imitatedSender(host);
  if (sender !== null) {
    return `El correo trae un link a ${host}, que imita ${sender}. No abrimos sus links.`;
  }
  return `El correo trae un link a ${host}, que no pertenece a un remitente permitido. No abrimos sus links.`;
}

/** Returns a calm reason when an allowed sender's mail has suspicious content or links. */
export function suspiciousReason(mail: Pick<IncomingMail, "subject" | "text" | "links">): string | null {
  for (const link of mail.links) {
    let host: string;
    try {
      host = new URL(link).hostname;
    } catch {
      return outsideLinkReason(link);
    }
    if (!isAllowedLinkHost(host)) return outsideLinkReason(link);
  }

  // A bank's own warning («nunca te pediremos tu clave») is not a request for it.
  const content = normalize(`${mail.subject}\n${mail.text}`).replace(/\bnunca\b[^.!?\n]*/g, "");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    return "El correo pide o intenta confirmar datos privados. No abrimos sus links.";
  }
  return null;
}
