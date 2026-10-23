/** Who an allowed sender is. */
export type SenderKind = "banco" | "tienda" | "catalogo";

export type Sender = { domain: string; kind: SenderKind };

/** The senders Luna may read; every other mail stays unread. */
export const SENDERS: readonly Sender[] = [
  { domain: "bancoficticio.example", kind: "banco" },
  { domain: "tiendaplaza.example", kind: "tienda" },
  { domain: "catalogoaurora.example", kind: "catalogo" },
];

/** The allowed sender domains, for the mail port to filter on. */
export function allowedSenderDomains(): string[] {
  return SENDERS.map((r) => r.domain);
}

/**
 * The domain of `from`, lowercased; `from` is one bare address or `Nombre <addr@dom>`.
 * Quoted display names are dropped first, so `"x <a@banco>" <b@otro>` reads `otro`;
 * a header with several mailboxes, or otherwise ambiguous, gives null.
 */
export function senderDomain(from: string): string | null {
  const unquoted = from.replace(/"(?:[^"\\]|\\.)*"/g, "");
  if (unquoted.includes('"') || unquoted.includes(",")) return null;
  const angled = [...unquoted.matchAll(/<([^<>]*)>/g)];
  if (angled.length > 1 || (unquoted.match(/[<>]/g)?.length ?? 0) !== angled.length * 2) return null;
  const address = (angled.length === 1 ? angled[0]![1]! : unquoted).trim();
  if (/\s/.test(address)) return null;
  const at = address.lastIndexOf("@");
  if (at < 0 || address.indexOf("@") !== at) return null;
  return address.slice(at + 1).toLowerCase();
}

/** The allowed sender `from` belongs to, matching its domain exactly; null otherwise. */
export function allowedSender(from: string): Sender | null {
  const domain = senderDomain(from);
  if (domain === null) return null;
  return SENDERS.find((r) => r.domain === domain) ?? null;
}
