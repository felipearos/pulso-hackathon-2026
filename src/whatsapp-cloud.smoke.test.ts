import { expect, test } from "bun:test";
import { systemClock } from "./real-ports";
import { createWhatsAppCloud } from "./whatsapp-cloud";

/*
 * Smoke test against Meta's real WhatsApp Cloud API, the only test in the repo
 * that touches the network. It runs only when WHATSAPP_ACCESS_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_SMOKE_TO (a Meta test number the
 * operator sets) are all present, e.g. under `doppler run`; otherwise it skips.
 */

const missingCredentials =
  !process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_SMOKE_TO;

test.skipIf(missingCredentials)(
  "sends one free-form text through Meta's API",
  async () => {
    const whatsapp = createWhatsAppCloud({
      env: { ...process.env, WHATSAPP_RECIPIENT_PHONE: process.env.WHATSAPP_SMOKE_TO },
      clock: systemClock,
    });
    whatsapp.recordInbound(systemClock.now());
    const text = "Prueba de humo de Pulso: si te llega esto, el envío funciona.";
    const { id } = await whatsapp.send({ kind: "text", text });
    expect(id).not.toBe("");
  },
  20000,
);
