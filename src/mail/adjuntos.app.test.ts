import { describe, expect, test } from "bun:test";
import type { IncomingMail } from "../ports";
import { createTestApp } from "../testing";

const BANCO = "avisos@bancoficticio.example";
const PDF = { nombre: "Estado.pdf", mimeType: "application/octet-stream", bytes: new TextEncoder().encode("%PDF-1.4 ficticio") };

describe("mails with a pdf attachment through the app", () => {
  test("a mail with adjuntos takes the same way in through Gmail and tick as one without", async () => {
    const { app, clock, mail: gmail } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: true });

    const injected = gmail.inject({ from: BANCO, subject: "Tu compra en 3 cuotas en Farmacia Ejemplo", receivedAt: clock.now(), adjuntos: [PDF] });
    await app.tick();

    expect(app.store.senalForMail(injected.id)?.tipo).toBe("S4");
  });

  test("receiveMail accepts a mail with adjuntos", async () => {
    const { app, clock } = createTestApp();
    const mail: IncomingMail = {
      id: "adjunto-1",
      from: BANCO,
      subject: "Tu compra en 6 cuotas en Zapatería Centro",
      text: "",
      receivedAt: clock.now(),
      links: [],
      adjuntos: [PDF],
    };

    const senal = await app.receiveMail(mail);

    expect(senal?.tipo).toBe("S4");
  });
});
