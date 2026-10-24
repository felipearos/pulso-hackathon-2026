import { HAIKU_MODEL } from "../claude-cli";
import type { Store } from "../patricia/store";
import type { Llm } from "../ports";
import { VOZ_OTRA, type Voz } from "../voice/voces";

/** What Patricia answered to the bienvenida; a field is present only when she said it. */
export type RespuestasBienvenida = { nombre?: string; hora?: string; voz?: Voz };

/** The night hour the bienvenida proposes, kept when she says it suits her. */
const HORA_PROPUESTA = "22:30";

const SYSTEM_PROMPT = `Patricia responde a la bienvenida de Luna, que le preguntó cómo le gusta que le digan y si le acomoda la hora de la noche (lunes y jueves 22:30, domingo 21:30) o qué hora prefiere.
Responde SOLO un objeto JSON con la forma {"nombre":<texto o null>,"hora":"<HH:MM>" o null,"acomoda":<true, false o null>}.
Reglas:
- nombre: solo si dice cómo le gusta que le digan; si no, null.
- acomoda: true si dice que la hora de la noche le acomoda; false si dice que no; null si no lo dice.
- hora: solo si nombra otra hora, en formato de 24 horas HH:MM; si no, null.
No agregues explicaciones, formato Markdown ni texto fuera del JSON.`;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** «otra voz» asked for, not refused: «no quiero otra voz» keeps the one she has. */
function pideOtraVoz(text: string): boolean {
  const normalized = normalize(text);
  return normalized.includes("otra voz") && !/\b(no|ni|nunca|sin)\b(?: \S+){0,3} otra voz/.test(normalized);
}

function validNombre(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const nombre = value.trim();
  if (nombre.length < 1 || nombre.length > 40 || /\d/.test(nombre)) return undefined;
  return nombre;
}

/** A real `HH:MM` between 18:00 and 23:59: Luna never speaks in the madrugada. */
function validHora(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 18 || hours > 23 || minutes > 59) return undefined;
  return `${match[1]}:${match[2]}`;
}

function parseReply(reply: string): Pick<RespuestasBienvenida, "nombre" | "hora"> {
  const objectText = reply.match(/\{[\s\S]*?\}/)?.[0];
  if (objectText === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText) as unknown;
  } catch {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const values = parsed as Record<string, unknown>;
  const result: Pick<RespuestasBienvenida, "nombre" | "hora"> = {};
  const nombre = validNombre(values.nombre);
  if (nombre !== undefined) result.nombre = nombre;
  const hora = validHora(values.hora) ?? (values.acomoda === true ? HORA_PROPUESTA : undefined);
  if (hora !== undefined) result.hora = hora;
  return result;
}

/** Reads how she wants to be called, her hour and her voz from one answer; never throws. */
export async function leerRespuestasBienvenida(
  text: string,
  llm: Llm,
  options?: { timeoutMs?: number },
): Promise<RespuestasBienvenida> {
  const respuestas: RespuestasBienvenida = {};
  if (pideOtraVoz(text)) respuestas.voz = VOZ_OTRA;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("LLM request timed out")), options?.timeoutMs ?? 8000);
    });
    const reply = await Promise.race([
      llm.complete({
        model: HAIKU_MODEL,
        system: SYSTEM_PROMPT,
        prompt: `Respuesta de Patricia a la bienvenida (texto o transcripción de audio):\n${JSON.stringify(text)}`,
      }),
      timeout,
    ]);
    return { ...parseReply(reply), ...respuestas };
  } catch {
    return respuestas;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const CAMPOS = ["nombre", "hora", "voz"] as const satisfies readonly (keyof RespuestasBienvenida)[];

function enumerar(campos: readonly string[]): string {
  if (campos.length <= 1) return campos.join("");
  return `${campos.slice(0, -1).join(", ")} y ${campos[campos.length - 1]}`;
}

/** True while the last cita that went out is the bienvenida. */
function bienvenidaEnCurso(store: Store): boolean {
  const enviadas = store.citas().filter((cita) => cita.mensajeSalienteId !== null);
  const ultima = enviadas.reduce<(typeof enviadas)[number] | null>(
    (latest, cita) =>
      latest === null || cita.fecha > latest.fecha || (cita.fecha === latest.fecha && cita.id > latest.id)
        ? cita
        : latest,
    null,
  );
  return ultima?.tipo === "bienvenida";
}

/**
 * Keeps what Patricia answered to the bienvenida while it is in curso. Returns
 * null and does nothing once another cita went out, or before any did.
 */
export async function recibirRespuestaBienvenida(
  deps: { store: Store; llm: Llm },
  text: string,
): Promise<RespuestasBienvenida | null> {
  if (!bienvenidaEnCurso(deps.store)) return null;

  const respuestas = await leerRespuestasBienvenida(text, deps.llm);
  const campos = CAMPOS.filter((campo) => respuestas[campo] !== undefined);
  if (campos.length === 0) return {};

  deps.store.updatePatricia(respuestas);
  deps.store.recordDecision({
    tipo: "mensaje",
    motivo: `guardó lo que respondió a la bienvenida: ${enumerar(campos)}`,
    datos: { text, respuestas },
  });
  return respuestas;
}
