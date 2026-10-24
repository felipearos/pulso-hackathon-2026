/*
 * Patricia's RUT, the clave her banks lock the estado de cuenta PDF with.
 * Only the shape is checked here: the cuerpo and its dígito verificador
 * (módulo 11). Nothing in this file logs or stores it.
 */

/** Shortest and longest cuerpo a RUT has; anything else is a typo. */
const MIN_CUERPO_DIGITS = 6;
const MAX_CUERPO_DIGITS = 8;

/** The dígito verificador of a cuerpo, by módulo 11: "0"–"9" or "K". */
export function digitoVerificador(cuerpo: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    sum += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return "0";
  if (rest === 10) return "K";
  return String(rest);
}

/**
 * The RUT as `12345678-5` (no dots, a hyphen, uppercase `K`), or null when it
 * is empty, has the wrong length or its dígito verificador does not match.
 * Accepts dots, a hyphen, spaces and a lowercase `k`.
 */
export function normalizeRut(input: string): string | null {
  const compact = input.replace(/[.\s-]/g, "").toUpperCase();
  const match = /^(\d+)([\dK])$/.exec(compact);
  if (!match) return null;
  const cuerpo = match[1]!.replace(/^0+/, "");
  const dv = match[2]!;
  if (cuerpo.length < MIN_CUERPO_DIGITS || cuerpo.length > MAX_CUERPO_DIGITS) return null;
  if (digitoVerificador(cuerpo) !== dv) return null;
  return `${cuerpo}-${dv}`;
}
