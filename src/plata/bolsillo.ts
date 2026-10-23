/** Pure bolsillo parsing and texts. Luna never moves money or asks whether Patricia moved it. */

export type RespuestaBolsillo = "si" | "no" | "no-sabe";

const SKIN_TONE = "[\\u{1F3FB}-\\u{1F3FF}]";
const THUMBS_UP = new RegExp(`^(?:👍\\uFE0F?${SKIN_TONE}?)+$`, "u");
const THUMBS_DOWN = new RegExp(`^(?:👎\\uFE0F?${SKIN_TONE}?)+$`, "u");
const SHRUG = new RegExp(`^(?:🤷\\uFE0F?${SKIN_TONE}?(?:\\u200D[♀♂]\\uFE0F?)?)+$`, "u");

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Reads a direct answer about whether Patricia's bank offers her a bolsillo. */
export function respuestaBolsilloDe(text: string): RespuestaBolsillo | null {
  const trimmed = text.trim();
  if (THUMBS_UP.test(trimmed)) return "si";
  if (THUMBS_DOWN.test(trimmed)) return "no";
  if (SHRUG.test(trimmed)) return "no-sabe";

  const words = normalize(text).replace(/[.,!¡¿?]+$/u, "").trim();
  switch (words) {
    case "si":
      return "si";
    case "no":
      return "no";
    case "no se":
    case "nose":
    case "ni idea":
      return "no-sabe";
    default:
      return null;
  }
}

/** Returns a short name Patricia gave her bolsillo, or null when it is not usable. */
export function nombreDeBolsillo(text: string): string | null {
  let nombre = text.trim();
  const quotePairs = [["«", "»"], ["\"", "\""], ["'", "'"]] as const;

  while (nombre.length >= 2) {
    const pair = quotePairs.find(([opening, closing]) => nombre.startsWith(opening) && nombre.endsWith(closing));
    if (!pair) break;
    nombre = nombre.slice(pair[0].length, -pair[1].length).trim();
  }

  nombre = nombre.replace(/\s+/gu, " ");
  if (nombre.length === 0 || [...nombre.normalize("NFC")].length > 40) return null;
  if (!/[\p{L}\p{N}]/u.test(nombre)) return null;
  return nombre;
}

export const PREGUNTA_BOLSILLO = "Una pregunta, una sola vez: ¿tu banco te deja tener un bolsillo o una cuenta de ahorro? 👍 sí · 👎 no · 🤷 no sé";
export const PEDIR_NOMBRE = "¡Qué bueno! ¿Qué nombre le pones? Así voy a llamar a lo que apartas.";
export const SIN_BOLSILLO = "Gracias por contarme. No te vuelvo a preguntar.";

/** Confirms the name Luna will use for Patricia's plata apartada. */
export function bolsilloNombrado(nombre: string): string {
  return `Listo: desde ahora lo que apartas se llama «${nombre}».`;
}
