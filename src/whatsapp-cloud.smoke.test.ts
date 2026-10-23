import { expect, test } from "bun:test";
import { systemClock } from "./real-ports";
import { createWhatsAppCloud } from "./whatsapp-cloud";

/*
 * Smoke test against Meta's real WhatsApp Cloud API: the only test in the repo
 * that touches the network, and the only one that sends a real message.
 *
 * It is opt-in, so the loops' and CI's `bun run test` never fire it even with
 * every credential injected: it runs only when WHATSAPP_SMOKE is set, on top of
 * WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_SMOKE_TO (a Meta
 * test number). WHATSAPP_SMOKE belongs in no Doppler config; the operator sets
 * it on the command line for one run:
 *
 *   WHATSAPP_SMOKE=1 doppler run -- bun test src/whatsapp-cloud.smoke.test.ts
 *
 * Message the test number from WhatsApp first. The test exercises the free-form
 * path, which Meta accepts only inside the 24 h window her own message opens.
 */

const env = process.env;
const skip = !env.WHATSAPP_SMOKE || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_SMOKE_TO;

test.skipIf(skip)(
  "sends one free-form text through Meta's API",
  async () => {
    const whatsapp = createWhatsAppCloud({
      env: { ...env, WHATSAPP_RECIPIENT_PHONE: env.WHATSAPP_SMOKE_TO },
      clock: systemClock,
    });
    whatsapp.recordInbound(systemClock.now());
    const text = "Prueba de humo de Pulso: si te llega esto, el envío funciona.";
    const { id } = await whatsapp.send({ kind: "text", text });
    expect(id).not.toBe("");
  },
  20000,
);
