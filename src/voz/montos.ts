// Every amount is followed by a noun (mil, millón, pesos), so "uno" is always
// apocopated to "un".
const UNITS = [
  "", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos",
  "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos",
];

const MAX = 999_999_999_999;

function assertMonto(pesos: number): void {
  if (!Number.isInteger(pesos) || pesos < 0 || pesos > MAX) {
    throw new RangeError(`monto must be a whole number of pesos from 0 to ${MAX}, got ${pesos}`);
  }
}

function belowHundred(n: number): string {
  if (n < 30) return UNITS[n]!;
  const unit = n % 10;
  return unit === 0 ? TENS[n / 10]! : `${TENS[Math.floor(n / 10)]} y ${UNITS[unit]}`;
}

function belowThousand(n: number): string {
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [HUNDREDS[hundreds]!, rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

function belowMillion(n: number): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 0 ? "" : thousands === 1 ? "mil" : `${belowThousand(thousands)} mil`;
  return [head, rest ? belowThousand(rest) : ""].filter(Boolean).join(" ");
}

export function montoEnPalabras(pesos: number): string {
  assertMonto(pesos);
  if (pesos === 0) return "cero pesos";
  if (pesos === 1) return "un peso";
  const millions = Math.floor(pesos / 1_000_000);
  const rest = pesos % 1_000_000;
  if (millions === 0) return `${belowMillion(rest)} pesos`;
  const head = millions === 1 ? "un millón" : `${belowMillion(millions)} millones`;
  return rest === 0 ? `${head} de pesos` : `${head} ${belowMillion(rest)} pesos`;
}

export function montoEnPantalla(pesos: number): string {
  assertMonto(pesos);
  return `$${String(pesos).replace(/\B(?=(\d{3})+$)/g, ".")}`;
}
