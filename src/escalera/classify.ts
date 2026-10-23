import type { Llm } from "../ports";
import type { Angustia, Intencion } from "./policy";

export const CRISIS_PHRASES = [
  "no quiero vivir",
  "no quiero seguir viviendo",
  "no doy más",
  "no puedo más",
  "quitarme la vida",
  "matarme",
  "suicid",
  "mejor muerta",
  "mejor muerto",
  "no despertar",
  "quiero desaparecer",
  "terminar con todo",
  "no vale la pena vivir",
  "para qué seguir",
] as const;

const SYSTEM_PROMPT = `Clasifica el mensaje de Patricia en una sola intención.
Responde SOLO un objeto JSON con la forma {"intencion":"<tipo>"}; para angustia usa {"intencion":"angustia","valor":<entero de 1 a 5>}.
Los tipos permitidos son:
- listened: escuchó o solo confirma que recibió el audio.
- accepted: acepta responder o hacer lo propuesto en la cita.
- minimum: cuenta que pagó o piensa pagar solo el pago mínimo.
- angustia: dice cómo se siente, con valor de angustia de 1 (poca) a 5 (mucha).
- doesNotWantToSee: no quiere mirar su estado de cuenta o sus deudas.
- pause: pide una pausa o que Luna deje de escribirle.
- hello: saluda sin otra intención clara.
- askWhy: pregunta por qué Luna le dice o propone algo.
- askWhatRead: pregunta qué leyó Luna de su estado de cuenta.
- installmentPurchase: cuenta que compró algo en cuotas.
- crisis: cualquier indicio de autolesión, suicidio, desesperanza o de no querer seguir viviendo.
- other: el mensaje no corresponde claramente a los otros tipos.
Si hay cualquier indicio de autolesión o desesperanza, responde crisis. No agregues explicaciones, formato Markdown ni texto fuera del JSON.`;

const OTHER: Intencion = { kind: "other" };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Phrases that also talk about amounts: «no puedo más que el mínimo», «no doy más de 20 mil». */
const AMOUNT_PHRASES: ReadonlySet<string> = new Set(["no doy más", "no puedo más"]);

/** Only an amount phrase followed by "que" or "de" is money talk; every other phrase is crisis as is. */
const CRISIS_PATTERNS = CRISIS_PHRASES.map((phrase) => {
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(AMOUNT_PHRASES.has(phrase) ? `${escaped}(?! (?:que|de)\\b)` : escaped);
});

function hasCrisisPhrase(message: string): boolean {
  const normalized = normalize(message);
  return CRISIS_PATTERNS.some((pattern) => pattern.test(normalized));
}

function parseIntencion(reply: string): Intencion {
  const objectText = reply.match(/\{[\s\S]*?\}/)?.[0];
  if (!objectText) return OTHER;

  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText) as unknown;
  } catch {
    return OTHER;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return OTHER;
  const intencion = (parsed as Record<string, unknown>).intencion;

  switch (intencion) {
    case "listened":
    case "accepted":
    case "minimum":
    case "doesNotWantToSee":
    case "pause":
    case "hello":
    case "askWhy":
    case "askWhatRead":
    case "installmentPurchase":
    case "crisis":
      return { kind: intencion };
    case "angustia": {
      const value = (parsed as Record<string, unknown>).valor;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
        return OTHER;
      }
      return { kind: "angustia", value: value as Angustia };
    }
    default:
      return OTHER;
  }
}

export function isOnlyEmoji(message: string, emoji: "👍" | "👌"): boolean {
  const modifier = "[🏻-🏿]";
  const pattern = emoji === "👍" ? new RegExp(`^(?:👍️?${modifier}?)+$`, "u") : new RegExp(`^(?:👌️?${modifier}?)+$`, "u");
  return pattern.test(message.trim());
}

/** Classifies one text message or voice-note transcript from Patricia. */
export async function classifyIntencion(
  message: string,
  llm: Llm,
  options?: { timeoutMs?: number },
): Promise<Intencion> {
  if (hasCrisisPhrase(message)) return { kind: "crisis" };
  if (isOnlyEmoji(message, "👍")) return { kind: "accepted" };
  if (isOnlyEmoji(message, "👌")) return { kind: "listened" };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("LLM request timed out")), options?.timeoutMs ?? 8000);
    });
    const reply = await Promise.race([
      llm.complete({
        system: SYSTEM_PROMPT,
        prompt: `Mensaje de Patricia (texto o transcripción de audio):\n${JSON.stringify(message)}`,
      }),
      timeout,
    ]);
    return parseIntencion(reply);
  } catch {
    return OTHER;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
