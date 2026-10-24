import { HAIKU_MODEL } from "../claude-cli";
import type { Llm } from "../ports";

/** Every way a bank says its estado de cuenta PDF opens, as a closed list. */
export const REGLAS_DE_CLAVE = ["rut-sin-dv", "rut-con-dv", "primeros-n", "ultimos-n", "sin-clave"] as const;

export type ReglaDeClave = (typeof REGLAS_DE_CLAVE)[number];

/** The rules that take a digit count `n`. */
const REGLAS_CON_N: readonly ReglaDeClave[] = ["primeros-n", "ultimos-n"];

/** `12345678-5`: cuerpo digits, one hyphen, one dígito verificador. */
const RUT_PATTERN = /^(\d+)-([0-9kK])$/;

function validN(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/**
 * The clave a rule makes from Patricia's RUT (`12345678-5`, no dots), or null
 * when the RUT or `n` is malformed. `sin-clave` is always null: the caller
 * opens the PDF without a clave. Never throws.
 */
export function claveDesdeRut(rut: string, regla: ReglaDeClave, n?: number): string | null {
  const match = RUT_PATTERN.exec(rut);
  if (match === null) return null;
  const cuerpo = match[1] as string;
  const dv = (match[2] as string).toUpperCase();

  switch (regla) {
    case "rut-sin-dv":
      return cuerpo;
    case "rut-con-dv":
      return `${cuerpo}${dv}`;
    case "primeros-n":
      return validN(n) && n <= cuerpo.length ? cuerpo.slice(0, n) : null;
    case "ultimos-n":
      return validN(n) && n <= cuerpo.length ? cuerpo.slice(-n) : null;
    case "sin-clave":
      return null;
    default: {
      const unknownRegla: never = regla;
      return unknownRegla;
    }
  }
}

const SYSTEM_PROMPT = `Recibes el texto de un correo de un banco que trae adjunto el estado de cuenta en PDF. Tu tarea es decir cómo se abre ese PDF, según lo que dice el correo.
Responde SOLO un objeto JSON con la forma {"regla":"<una de la lista>" o null,"n":<entero positivo o null>}.
La regla es una de estas:
- "rut-sin-dv": la clave es el RUT sin puntos, sin guión y sin dígito verificador.
- "rut-con-dv": la clave es el RUT sin puntos ni guión, con el dígito verificador.
- "primeros-n": la clave son los primeros n dígitos del RUT (sin dígito verificador); n es esa cantidad.
- "ultimos-n": la clave son los últimos n dígitos del RUT (sin dígito verificador); n es esa cantidad.
- "sin-clave": el correo dice que el PDF no tiene clave o no está protegido.
n: solo para "primeros-n" y "ultimos-n"; en las demás, null.
Si el correo no dice cómo se abre el PDF, o la regla no es ninguna de la lista, responde {"regla":null,"n":null}.
No agregues explicaciones, formato Markdown ni texto fuera del JSON.`;

/** Anything shaped like a RUT, with or without dots and hyphen: banks print hers in the body. */
const RUT_IN_TEXT = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g;

/** The longest slice of the body Haiku reads; the instruction sits near the top. */
const MAX_BODY_CHARS = 2000;

/** The body with every RUT masked, so the RUT never reaches a prompt. */
function sinRut(text: string): string {
  return text.replace(RUT_IN_TEXT, "[RUT]").slice(0, MAX_BODY_CHARS);
}

function isRegla(value: unknown): value is ReglaDeClave {
  return typeof value === "string" && (REGLAS_DE_CLAVE as readonly string[]).includes(value);
}

function parseReply(reply: string): { regla: ReglaDeClave; n?: number } | null {
  const objectText = reply.match(/\{[\s\S]*?\}/)?.[0];
  if (objectText === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const values = parsed as Record<string, unknown>;
  if (!isRegla(values.regla)) return null;
  const regla = values.regla;
  if (!REGLAS_CON_N.includes(regla)) return { regla };
  return validN(values.n) ? { regla, n: values.n } : null;
}

/**
 * Reads from a bank email how its PDF opens, or null when it does not say or
 * the answer is not usable. The LLM sees only the email text, with any RUT
 * masked, never the clave. Never throws.
 */
export async function leerReglaDeClave(
  text: string,
  llm: Llm,
  options?: { timeoutMs?: number },
): Promise<{ regla: ReglaDeClave; n?: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("LLM request timed out")), options?.timeoutMs ?? 8000);
    });
    const reply = await Promise.race([
      llm.complete({
        model: HAIKU_MODEL,
        system: SYSTEM_PROMPT,
        prompt: `Texto del correo del banco:\n${JSON.stringify(sinRut(text))}`,
      }),
      timeout,
    ]);
    return parseReply(reply);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
