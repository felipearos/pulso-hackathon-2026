/**
 * Sends the madrugada answer (src/escalera/madrugada.ts) as a nota de voz and
 * keeps what Patricia wrote as a pendiente for the next cita. Not stored as a
 * MensajeSaliente: that list holds the citas.
 */

import { fromSantiago, santiagoParts } from "../clock/santiago";
import type { Store } from "../patricia/store";
import type { Voice, WhatsApp } from "../ports";
import { vozDe } from "../voice/voces";
import { madrugadaText, madrugadaTextOtraVez } from "./madrugada";

/** Whether a decision records a madrugada nota de voz that went out. */
function isMadrugadaAnswer(datos: unknown): boolean {
  if (typeof datos !== "object" || datos === null) return false;
  const record = datos as Record<string, unknown>;
  return record.madrugada === true && typeof record.whatsappId === "string";
}

/**
 * Whether Luna already answered once in this madrugada: read from the registro
 * de decisiones since 00:00 Santiago, so a restart keeps it.
 */
function answeredThisMadrugada(store: Store, now: Date): boolean {
  const { year, month, day } = santiagoParts(now);
  const start = fromSantiago({ year, month, day }).getTime();
  return store
    .decisions()
    .some((decision) => decision.at.getTime() >= start && decision.tipo === "mensaje" && isMadrugadaAnswer(decision.datos));
}

/**
 * Answers one madrugada message: stores her worry as a pendiente, then sends
 * the fixed text as a nota de voz, the longer one first and the shorter one
 * after it the same night. A long audio still goes out, since the text is
 * fixed. A failure is logged and never thrown: her message is already stored.
 */
export async function answerMadrugada(
  deps: { store: Store; voice?: Voice; whatsapp: WhatsApp },
  input: { text: string; whatsappId: string | null; now: Date },
): Promise<void> {
  const { store, voice, whatsapp } = deps;
  store.addPendiente({
    tipo: "preocupacion",
    motivo: "preocupación de madrugada",
    datos: { text: input.text, whatsappId: input.whatsappId },
  });

  const { nombre, voz } = store.getPatricia();
  const text = answeredThisMadrugada(store, input.now) ? madrugadaTextOtraVez(nombre) : madrugadaText(nombre);
  try {
    if (!voice) throw new Error("no voice port to speak the madrugada answer");
    const audio = await voice.synthesize(text, vozDe(voz));
    // No retry: the WhatsApp adapter does not retry in the madrugada either.
    const { id: whatsappId } = await whatsapp.send({
      kind: "audio",
      audio: audio.audio,
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
    });
    store.recordDecision({
      tipo: "mensaje",
      motivo: `respondió de madrugada: nota de voz de ${Math.round(audio.durationSeconds)} s`,
      datos: { madrugada: true, text, whatsappId, durationSeconds: audio.durationSeconds },
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    console.error(`madrugada: answer failed: ${error}`);
    store.recordDecision({
      tipo: "mensaje",
      motivo: "no se pudo enviar la nota de madrugada",
      datos: { madrugada: true, text, error },
    });
  }
}
