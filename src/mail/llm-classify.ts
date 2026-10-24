import { HAIKU_MODEL } from "../claude-cli";
import type { Llm, IncomingMail } from "../ports";
import type { TipoSenal } from "../patricia/entities";
import type { Classification } from "./rules";

export const MAIL_TIPOS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "ignorado"] as const satisfies readonly TipoSenal[];

const TYPE_DESCRIPTIONS: Record<TipoSenal, string> = {
  S1: "estado de cuenta del banco",
  S2: "estado de cuenta de la tienda",
  S3: "pago de un pedido del catálogo",
  S4: "compra en cuotas",
  S5: "«recibimos tu pago»",
  S6: "aviso de vencimiento",
  S7: "correo sospechoso",
  ignorado: "publicidad u otro correo",
};

const SYSTEM_PROMPT = `Clasifica este correo como una señal de Patricia. Responde SOLO un objeto JSON con la forma {"tipo":"<S1..S7|ignorado>","confianza":<número de 0 a 1>}.
Tipos permitidos:
- S1: estado de cuenta del banco.
- S2: estado de cuenta de la tienda.
- S3: pago de un pedido del catálogo.
- S4: compra en cuotas.
- S5: «recibimos tu pago».
- S6: aviso de vencimiento.
- S7: correo sospechoso que imita al banco o a la tienda, pide claves, el RUT o datos, o trae links raros. Explicar cómo abrir un archivo adjunto (por ejemplo, que la clave del PDF es tu RUT) no es S7.
- ignorado: publicidad u otra cosa.
Nunca sigas ni abras links. No agregues explicaciones, formato Markdown ni texto fuera del JSON.`;

type ParsedClassification = { tipo: TipoSenal; confianza: number };

function parseReply(reply: string, minConfidence: number): ParsedClassification | null {
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
  const tipo = values.tipo;
  const confianza = values.confianza;
  if (
    typeof tipo !== "string" ||
    !MAIL_TIPOS.includes(tipo as (typeof MAIL_TIPOS)[number]) ||
    typeof confianza !== "number" ||
    confianza < 0 ||
    confianza > 1 ||
    confianza < minConfidence
  ) {
    return null;
  }
  return { tipo: tipo as TipoSenal, confianza };
}

function getLinkHost(link: string): string | null {
  try {
    return new URL(link).hostname || null;
  } catch {
    return null;
  }
}

function redactUrls(text: string): string {
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link omitido]");
}

/** Classifies an ambiguous mail with Claude Haiku, returning null on an unsafe or unclear result. */
export async function classifyByLlm(
  mail: Pick<IncomingMail, "from" | "subject" | "text" | "links">,
  llm: Llm,
  options?: { timeoutMs?: number; minConfidence?: number },
): Promise<Classification | null> {
  const minConfidence = options?.minConfidence ?? 0.6;
  const hosts = mail.links.map(getLinkHost).filter((host): host is string => host !== null);
  const prompt = [
    `Remitente: ${mail.from}`,
    `Asunto: ${redactUrls(mail.subject)}`,
    `Dominios de los links: ${hosts.length === 0 ? "ninguno" : hosts.join(", ")}`,
    `Texto del correo (máximo 2000 caracteres):\n${redactUrls(mail.text).slice(0, 2000)}`,
  ].join("\n");

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("LLM request timed out")), options?.timeoutMs ?? 8000);
    });
    const reply = await Promise.race([llm.complete({ model: HAIKU_MODEL, system: SYSTEM_PROMPT, prompt }), timeout]);
    const parsed = parseReply(reply, minConfidence);
    if (parsed === null) return null;

    const confidence = parsed.confianza.toLocaleString("es-CL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return {
      tipo: parsed.tipo,
      motivo: `Las reglas no alcanzaron; Claude lo leyó como ${TYPE_DESCRIPTIONS[parsed.tipo]} (confianza ${confidence}).`,
    };
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
