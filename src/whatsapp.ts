const GRAPH_API = "https://graph.facebook.com/v25.0";

// Meta only renders a voice note (not an audio file) when the upload declares
// the Opus codec and the message sets `voice: true`.
const VOICE_NOTE_TYPE = "audio/ogg; codecs=opus";

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
}

const REQUIRED = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] as const;

export type WhatsAppSetup =
  | { ok: true; config: WhatsAppConfig }
  | { ok: false; missing: string[] };

export function whatsappConfig(env: Record<string, string | undefined> = process.env): WhatsAppSetup {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: { token: env.WHATSAPP_TOKEN ?? "", phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "" },
  };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Uploads an OGG Opus file and sends it to `to` as a WhatsApp voice note.
 * Resolves with Meta's message id. Meta accepts the message even outside the
 * 24 h window; in that case delivery fails later and only the status webhook
 * would tell, so Patricia has to have written first.
 */
export async function sendVoiceNote(
  config: WhatsAppConfig,
  to: string,
  audio: Blob,
  fetchFn: Fetch = fetch,
): Promise<string> {
  const auth = { Authorization: `Bearer ${config.token}` };

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", VOICE_NOTE_TYPE);
  form.append("file", new Blob([await audio.arrayBuffer()], { type: VOICE_NOTE_TYPE }), "audio.ogg");
  const upload = await graph(fetchFn, `${GRAPH_API}/${config.phoneNumberId}/media`, {
    method: "POST",
    headers: auth,
    body: form,
  });

  const sent = await graph(fetchFn, `${GRAPH_API}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { id: upload.id, voice: true },
    }),
  });
  const messageId = sent.messages?.[0]?.id;
  if (!messageId) throw new Error("Meta no devolvió el id del mensaje");
  return messageId;
}

interface GraphBody {
  id?: string;
  messages?: { id?: string }[];
  error?: { message?: string; code?: number };
}

async function graph(fetchFn: Fetch, url: string, init: RequestInit): Promise<GraphBody & { id: string }> {
  const response = await fetchFn(url, init);
  const body = (await response.json()) as GraphBody;
  if (!response.ok || body.error) {
    const reason = body.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Meta respondió con un error: ${reason}`);
  }
  return { ...body, id: body.id ?? "" };
}
