/** Who an allowed sender is. */
export type SenderKind = "banco" | "tienda" | "catalogo";

export type Sender = { domain: string; kind: SenderKind };

/** The senders Luna may read; every other mail stays unread. */
export const SENDERS: readonly Sender[] = [
  { domain: "bancoandino.example", kind: "banco" },
  { domain: "tiendaplaza.example", kind: "tienda" },
  { domain: "catalogoaurora.example", kind: "catalogo" },
];

/** The allowed sender domains, for the mail port to filter on. */
export function allowedSenderDomains(): string[] {
  return SENDERS.map((r) => r.domain);
}

/** The domain of `from`, lowercased; `from` is a bare address or `Nombre <addr@dom>`. */
export function senderDomain(from: string): string | null {
  const angled = /<([^<>]*)>/.exec(from);
  const address = (angled ? angled[1]! : from).trim();
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  return address.slice(at + 1).toLowerCase();
}

/** The allowed sender `from` belongs to, matching its domain exactly; null otherwise. */
export function allowedSender(from: string): Sender | null {
  const domain = senderDomain(from);
  if (domain === null) return null;
  return SENDERS.find((r) => r.domain === domain) ?? null;
}
