/** Who an allowed sender is. */
export type TipoRemitente = "banco" | "tienda" | "catalogo";

export type Remitente = { dominio: string; tipo: TipoRemitente };

/** The senders Luna may read; every other mail stays unread. */
export const REMITENTES: readonly Remitente[] = [
  { dominio: "bancoandino.example", tipo: "banco" },
  { dominio: "tiendaplaza.example", tipo: "tienda" },
  { dominio: "catalogoaurora.example", tipo: "catalogo" },
];

/** The allowed sender domains, for the mail port to filter on. */
export function dominiosPermitidos(): string[] {
  return REMITENTES.map((r) => r.dominio);
}

/** The domain of `from`, lowercased; `from` is a bare address or `Nombre <addr@dom>`. */
export function dominioDe(from: string): string | null {
  const angled = /<([^<>]*)>/.exec(from);
  const address = (angled ? angled[1]! : from).trim();
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  return address.slice(at + 1).toLowerCase();
}

/** The allowed sender `from` belongs to, matching its domain exactly; null otherwise. */
export function remitentePermitido(from: string): Remitente | null {
  const dominio = dominioDe(from);
  if (dominio === null) return null;
  return REMITENTES.find((r) => r.dominio === dominio) ?? null;
}
