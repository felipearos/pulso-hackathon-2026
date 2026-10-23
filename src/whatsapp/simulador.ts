import { randomUUID } from "node:crypto";
import type { IncomingMedia, OutgoingWhatsApp, WhatsApp } from "../ports";

/**
 * The simulador: a WhatsApp port that keeps the conversation in memory, so the
 * demo can show Luna and Patricia on a page when Meta's number is not there to
 * write to. It never touches the network.
 */

/** One message Luna sent to the simulador, with the id `send` answered. */
export type SimuladorSent = Readonly<{ id: string; message: Readonly<OutgoingWhatsApp> }>;

export type Simulador = WhatsApp & {
  downloadMedia(mediaId: string): Promise<IncomingMedia>;
  /** Stores bytes Patricia sent from the page; the id goes in her mensaje's body. */
  addMedia(media: IncomingMedia): string;
  /** The bytes of a sent audio or image, or of a media she added; null for text or an unknown id. */
  media(id: string): IncomingMedia | null;
  /** What was sent, in order. */
  sent(): readonly SimuladorSent[];
};

/** The port the app holds: the real one or the simulador, switchable while it runs. */
export type Canal = WhatsApp & {
  downloadMedia(mediaId: string): Promise<IncomingMedia>;
  isSimulador(): boolean;
  setSimulador(active: boolean): void;
};

const SIMULADOR_ID_PREFIX = "sim-";

export function createSimulador(): Simulador {
  const outgoing: SimuladorSent[] = [];
  const incoming = new Map<string, IncomingMedia>();

  async function send(message: OutgoingWhatsApp): Promise<{ id: string }> {
    // A uuid, not a count: the store keeps old ids across a restart, and a reused
    // one would make an old audio on the page play a new message's bytes.
    const id = `sim-out-${randomUUID()}`;
    // Frozen so a caller holding `sent()` cannot rewrite the conversation the page shows.
    outgoing.push(Object.freeze({ id, message: Object.freeze({ ...message }) }));
    return { id };
  }

  function recordInbound(_at: Date): void {
    // The simulador has no 24 h window: anything can go out at any time.
  }

  async function downloadMedia(mediaId: string): Promise<IncomingMedia> {
    const media = incoming.get(mediaId);
    if (!media) throw new Error(`simulador: no media with id ${mediaId}`);
    return media;
  }

  function addMedia(media: IncomingMedia): string {
    const id = `sim-media-${randomUUID()}`;
    incoming.set(id, { bytes: media.bytes, mimeType: media.mimeType });
    return id;
  }

  function media(id: string): IncomingMedia | null {
    const added = incoming.get(id);
    if (added) return added;
    const message = outgoing.find((entry) => entry.id === id)?.message;
    if (message?.kind === "audio") return { bytes: message.audio, mimeType: message.mimeType };
    if (message?.kind === "image") return { bytes: message.image, mimeType: message.mimeType };
    return null;
  }

  function sent(): readonly SimuladorSent[] {
    return [...outgoing];
  }

  return { send, recordInbound, downloadMedia, addMedia, media, sent };
}

export function createCanal(real: WhatsApp, simulador: Simulador, initiallyActive: boolean): Canal {
  let active = initiallyActive;

  return {
    send: (message) => (active ? simulador.send(message) : real.send(message)),
    // Only Meta's webhook calls this, so it is always about the real number's window.
    recordInbound: (at) => real.recordInbound(at),
    async downloadMedia(mediaId) {
      // The id says where the bytes are, whichever side is active now: a nota de
      // voz sent through Meta before the switch still downloads from Meta.
      if (mediaId.startsWith(SIMULADOR_ID_PREFIX)) return simulador.downloadMedia(mediaId);
      if (!real.downloadMedia) throw new Error("the whatsapp port cannot download media");
      return real.downloadMedia(mediaId);
    },
    isSimulador: () => active,
    setSimulador(next) {
      active = next;
    },
  };
}
