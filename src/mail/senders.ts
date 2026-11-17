/** Who an allowed sender is. */
export type SenderKind = "banco" | "tienda" | "catalogo";

export type Sender = { domain: string; kind: SenderKind; address?: string };

/** The senders Luna may read; every other mail stays unread. */
export const SENDERS: readonly Sender[] = [
  { domain: "bancoficticio.example", kind: "banco" },
  { domain: "tiendaplaza.example", kind: "tienda" },
  { domain: "catalogoejemplo.example", kind: "catalogo" },
];

/**
 * Real addresses that stand in for a sender in the live demo, from `DEMO_SENDERS`
 * (`ana@example.com=banco,juan@example.com=tienda`): kept out of the repo, and
 * matched by the whole address, never by their domain.
 */
export function demoSenders(env: Record<string, string | undefined> = process.env): Sender[] {
  const kinds: readonly SenderKind[] = ["banco", "tienda", "catalogo"];
  return (env.DEMO_SENDERS ?? "")
    .split(",")
    .map((entry) => entry.trim().split("="))
    .flatMap(([address, kind]) => {
      const clean = address?.trim().toLowerCase() ?? "";
      const at = clean.lastIndexOf("@");
      if (at <= 0 || !kinds.includes(kind?.trim() as SenderKind)) return [];
      return [{ domain: clean.slice(at + 1), kind: kind!.trim() as SenderKind, address: clean }];
    });
}

/** The allowed sender domains, plus the demo's whole addresses, for the mail port to filter on. */
export function allowedSenderDomains(): string[] {
  return [...SENDERS.map((r) => r.domain), ...demoSenders().map((r) => r.address!)];
}

/**
 * The domain of `from`, lowercased; `from` is one bare address or `Nombre <addr@dom>`.
 * Quoted display names are dropped first, so `"x <a@banco>" <b@otro>` reads `otro`;
 * a header with several mailboxes, or otherwise ambiguous, gives null.
 */
export function senderDomain(from: string): string | null {
  const address = senderAddress(from);
  return address === null ? null : address.slice(address.lastIndexOf("@") + 1);
}

/** The address of `from`, lowercased; null when ambiguous, as in `senderDomain`. */
export function senderAddress(from: string): string | null {
  const unquoted = from.replace(/"(?:[^"\\]|\\.)*"/g, "");
  if (unquoted.includes('"') || unquoted.includes(",")) return null;
  const angled = [...unquoted.matchAll(/<([^<>]*)>/g)];
  if (angled.length > 1 || (unquoted.match(/[<>]/g)?.length ?? 0) !== angled.length * 2) return null;
  const address = (angled.length === 1 ? angled[0]![1]! : unquoted).trim();
  if (/\s/.test(address)) return null;
  const at = address.lastIndexOf("@");
  if (at < 0 || address.indexOf("@") !== at) return null;
  return address.toLowerCase();
}

/** The allowed sender `from` belongs to, matching its domain exactly; null otherwise. */
export function allowedSender(from: string): Sender | null {
  const address = senderAddress(from);
  if (address === null) return null;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return SENDERS.find((r) => r.domain === domain) ?? demoSenders().find((r) => r.address === address) ?? null;
}
