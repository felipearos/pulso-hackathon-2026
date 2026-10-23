/**
 * The crisis protocol: when Patricia writes something that reads as a crisis,
 * Luna answers at once, at any hour, with a fixed text that points her to the
 * phone lines. Never generated, never passed through the LLM.
 */

import type { Store } from "../patricia/store";
import type { WhatsApp } from "../ports";

/** The crisis text, calling her by her `nombre`. Wording pending clinical review by Cristian, issue #69. */
export function crisisText(nombre: string): string {
  return `${nombre}, te leo y me importa cómo estás. No tienes que pasar esto sola. Puedes llamar ahora a Salud Responde, 600 360 7777, atienden a toda hora. Si sientes que estás en peligro, marca *4141, la línea de prevención del suicidio, gratis desde tu celular. Aquí voy a estar cuando quieras volver a escribirme.`;
}

/**
 * Each attempt is one send: the WhatsApp adapter does not retry in the
 * madrugada, and the crisis text must still get through then.
 */
const CRISIS_ATTEMPTS = 3;

/**
 * Sends the crisis text by WhatsApp and logs it, or logs that it could not.
 * Not stored as a MensajeSaliente: that list holds the citas.
 */
export async function sendCrisisText(deps: { store: Store; whatsapp: WhatsApp }): Promise<void> {
  const { store, whatsapp } = deps;
  const text = crisisText(store.getPatricia().nombre);
  let lastError: unknown;
  for (let attempt = 1; attempt <= CRISIS_ATTEMPTS; attempt++) {
    try {
      const { id: whatsappId } = await whatsapp.send({ kind: "text", text });
      store.recordDecision({
        tipo: "mensaje",
        motivo: "envió el texto del protocolo de crisis",
        datos: { crisis: true, text, whatsappId },
      });
      return;
    } catch (cause) {
      lastError = cause;
    }
  }
  console.error("Could not send the crisis text to Patricia", lastError);
  // The control room must see that she wrote a crisis and got no answer.
  store.recordDecision({
    tipo: "mensaje",
    motivo: "no se pudo enviar el texto del protocolo de crisis",
    datos: { crisis: true, text, whatsappId: null, attempts: CRISIS_ATTEMPTS },
  });
}
