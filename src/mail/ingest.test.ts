import { describe, expect, test } from "bun:test";
import { createTestApp } from "../testing";
import { SAMPLE_MAILS } from "./samples";

const receivedAt = new Date("2026-10-19T08:00:00-03:00");

// An S1 also gets its estado de cuenta read by the extractor; only the classifying calls count here.
const classifyCalls = (calls: { prompt: string }[]) => calls.filter((call) => !call.prompt.startsWith("Estado de cuenta:"));

/** The test app with Patricia's «Permitir» given, so `tick` reads the mail port. */
function createAllowedApp(options: Parameters<typeof createTestApp>[0] = {}) {
  const testApp = createTestApp(options);
  testApp.app.store.updatePatricia({ gmailPermitido: true });
  return testApp;
}

describe("receiveMail", () => {
  test("classifies the bank, store, catalogue, cuotas and payment mails, one decision each", async () => {
    const { app, mail } = createAllowedApp();
    mail.inject({ id: "s1", from: "Banco Ficticio <avisos@bancoficticio.example>", subject: "Tu estado de cuenta de octubre", receivedAt });
    mail.inject({ id: "s2", from: "avisos@tiendaplaza.example", subject: "Estado de cuenta Tienda Plaza", receivedAt });
    mail.inject({ id: "s3", from: "pedidos@catalogoaurora.example", subject: "Pagamos tu pedido #1234", receivedAt });
    mail.inject({ id: "s4", from: "avisos@bancoficticio.example", subject: "Tu compra en 6 cuotas", receivedAt });
    mail.inject({ id: "s5", from: "avisos@tiendaplaza.example", subject: "¡Recibimos tu pago!", receivedAt });
    await app.tick();

    expect(app.store.senales().map((s) => [s.origen.mailId, s.tipo])).toEqual([
      ["s1", "S1"],
      ["s2", "S2"],
      ["s3", "S3"],
      ["s4", "S4"],
      ["s5", "S5"],
    ]);
    const decisions = app.store.decisions().filter((d) => d.tipo === "senal");
    expect(decisions.map((d) => d.tipo)).toEqual(["senal", "senal", "senal", "senal", "senal"]);
    for (const d of decisions) expect(d.motivo).toContain("Remitente");
    expect(decisions[0]!.datos).toEqual({
      mailId: "s1",
      from: "Banco Ficticio <avisos@bancoficticio.example>",
      subject: "Tu estado de cuenta de octubre",
      tipo: "S1",
    });
  });

  test.each([
    {
      id: "ambiguous-bank",
      from: "Banco Ficticio <avisos@bancoficticio.example>",
      subject: "Información importante de tu tarjeta",
      text: "El monto facturado fue $89.000 y el pago mínimo es $12.000.",
      tipo: "S1",
    },
    {
      id: "ambiguous-store",
      from: "Tienda Plaza <cuenta@tiendaplaza.example>",
      subject: "Tu documento del mes",
      text: "Ya puedes revisar el resumen mensual de tu cuenta de Tienda Plaza.",
      tipo: "S2",
    },
    {
      id: "ambiguous-installment",
      from: "Banco Ficticio <avisos@bancoficticio.example>",
      subject: "Movimiento aprobado en Farmacia Sol",
      text: "Registramos una compra que se pagará en cuatro pagos mensuales.",
      tipo: "S4",
    },
  ] as const)("asks Claude to classify the ambiguous $tipo mail", async ({ id, from, subject, text, tipo }) => {
    const { app, mail, llm } = createAllowedApp({ llm: [[subject, `{"tipo":"${tipo}","confianza":0.91}`]] });
    mail.inject({ id, from, subject, text, receivedAt });
    await app.tick();

    expect(classifyCalls(llm.calls)).toHaveLength(1);
    expect(app.store.senales().map((senal) => senal.tipo)).toEqual([tipo]);
    expect(app.store.decisions()[0]!.motivo).toContain("Claude");
    expect(app.store.decisions()[0]!.datos).toEqual(expect.objectContaining({ tipo }));
  });

  test("an LLM failure leaves an ambiguous mail ignored with the fallback motivo", async () => {
    const { app, mail, llm } = createAllowedApp();
    mail.inject({
      id: "llm-failure",
      from: "avisos@bancoficticio.example",
      subject: "Movimiento de octubre",
      text: "Hay novedades en tu cuenta.",
      receivedAt,
    });
    await app.tick();

    expect(classifyCalls(llm.calls)).toHaveLength(1);
    expect(app.store.senales()[0]?.tipo).toBe("ignorado");
    expect(app.store.decisions()[0]?.motivo).toContain("Claude no supo clasificarlo con confianza");
  });

  test("a low-confidence LLM result leaves an ambiguous mail ignored", async () => {
    const subject = "Movimiento especial de octubre";
    const { app, mail, llm } = createAllowedApp({
      llm: [[subject, '{"tipo":"S1","confianza":0.2}']],
    });
    mail.inject({ id: "low-confidence", from: "avisos@bancoficticio.example", subject, receivedAt });
    await app.tick();

    expect(classifyCalls(llm.calls)).toHaveLength(1);
    expect(app.store.senales()[0]?.tipo).toBe("ignorado");
    expect(app.store.decisions()[0]?.motivo).toContain("Claude no supo clasificarlo con confianza");
  });

  test("stores a suspicious sample as S7 without asking Claude", async () => {
    const { app, mail, llm } = createAllowedApp();
    mail.inject({ ...SAMPLE_MAILS.falso, links: [...SAMPLE_MAILS.falso.links] });
    await app.tick();

    expect(app.store.senales()).toHaveLength(1);
    expect(app.store.senales()[0]).toMatchObject({
      tipo: "S7",
      origen: {
        mailId: SAMPLE_MAILS.falso.id,
        from: SAMPLE_MAILS.falso.from,
        subject: SAMPLE_MAILS.falso.subject,
      },
    });
    expect(app.store.decisions()[0]?.motivo).toContain("No abrimos sus links");
    expect(llm.calls).toEqual([]);
  });

  test("classifies a catalogue promo as ignored without asking Claude", async () => {
    const { app, mail, llm } = createAllowedApp();
    mail.inject({ ...SAMPLE_MAILS.publicidad, links: [...SAMPLE_MAILS.publicidad.links] });
    await app.tick();

    expect(app.store.senales().map((senal) => senal.tipo)).toEqual(["ignorado"]);
    expect(app.store.decisions()).toHaveLength(1);
    expect(llm.calls).toEqual([]);
  });

  test("off-list and look-alike senders store nothing and record nothing", async () => {
    const { app, mail } = createAllowedApp();
    mail.inject({ from: "amiga@correo.example", subject: "Estado de cuenta", receivedAt });
    mail.inject({ from: "avisos@bancoficticio.example.fraude.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    expect(await app.receiveMail({
      id: "direct", from: "avisos@bancofictici0.example", subject: "Estado de cuenta", text: "", receivedAt, links: [],
    })).toBeNull();
    expect(app.store.senales()).toEqual([]);
    expect(app.store.decisions()).toEqual([]);
  });

  test("a «recibimos tu pago» stores its monto, from the subject or else the body", async () => {
    const { app } = createAllowedApp();
    const from = "avisos@bancoficticio.example";
    await app.receiveMail({ id: "p1", from, subject: "Banco Ficticio: recibimos tu pago de $50.000", text: "", receivedAt, links: [] });
    await app.receiveMail({ id: "p2", from, subject: "Recibimos tu pago", text: "Abonamos $41.900 a tu tarjeta.", receivedAt, links: [] });
    await app.receiveMail({ id: "p3", from, subject: "Recibimos tu pago", text: "", receivedAt, links: [] });

    expect(app.store.senales().map((s) => [s.tipo, s.monto])).toEqual([
      ["S5", 50_000],
      ["S5", 41_900],
      ["S5", null],
    ]);
    const datos = app.store.decisions().filter((d) => d.tipo === "senal").map((d) => d.datos as { monto?: number; aporte?: number });
    expect(datos.map((d) => d.monto)).toEqual([50_000, 41_900, undefined]);
    for (const d of datos) expect(d.aporte).toBeUndefined();
  });

  test("the same mail seen twice gives one señal and one decision", async () => {
    const { app, mail } = createAllowedApp();
    mail.inject({ id: "dup", from: "avisos@bancoficticio.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    mail.inject({ id: "dup", from: "avisos@bancoficticio.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    expect(app.store.senales()).toHaveLength(1);
    expect(app.store.decisions().filter((d) => d.tipo === "senal")).toHaveLength(1);
  });

  test("the same ambiguous mail calls Claude only once", async () => {
    const subject = "Información mensual de tu tarjeta";
    const { app, mail, llm } = createAllowedApp({ llm: [[subject, '{"tipo":"S1","confianza":0.9}']] });
    const incoming = {
      id: "llm-dup",
      from: "avisos@bancoficticio.example",
      subject,
      text: "El monto facturado está disponible.",
      receivedAt,
    };
    mail.inject(incoming);
    await app.tick();
    mail.inject(incoming);
    await app.tick();
    const again = await app.receiveMail({ ...incoming, links: [] });

    expect(again).toEqual(app.store.senales()[0]!);
    expect(classifyCalls(llm.calls)).toHaveLength(1);
    expect(app.store.senales()).toHaveLength(1);
    expect(app.store.decisions()).toHaveLength(1);
  });

  test("tick does not read the mail port without Patricia's permission, nor after she revokes it", async () => {
    const { app, mail } = createTestApp();
    let reads = 0;
    const fetchNew = mail.fetchNew.bind(mail);
    mail.fetchNew = (senders) => {
      reads += 1;
      return fetchNew(senders);
    };
    mail.inject({ id: "before", from: "avisos@bancoficticio.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    expect(reads).toBe(0);
    expect(app.store.senales()).toEqual([]);

    app.store.updatePatricia({ gmailPermitido: true });
    await app.tick();
    expect(app.store.senales().map((s) => s.origen.mailId)).toEqual(["before"]);

    app.store.updatePatricia({ gmailPermitido: false });
    mail.inject({ id: "after", from: "avisos@tiendaplaza.example", subject: "Recibimos tu pago", receivedAt });
    await app.tick();
    expect(reads).toBe(1);
    expect(app.store.senales()).toHaveLength(1);
  });

  test("a failing mail port does not make tick throw", async () => {
    const { app, mail } = createAllowedApp();
    mail.fetchNew = async () => {
      throw new Error("gmail caído");
    };
    const original = console.error;
    console.error = () => {};
    try {
      await app.tick();
    } finally {
      console.error = original;
    }
    expect(app.store.senales()).toEqual([]);
  });

  test("a mail whose decision fails leaves no señal and the batch goes on", async () => {
    const { app, mail } = createAllowedApp();
    const record = app.store.recordDecision;
    let calls = 0;
    app.store.recordDecision = (input) => {
      calls += 1;
      if (calls === 1) throw new Error("registro lleno");
      return record(input);
    };
    mail.inject({ id: "first", from: "avisos@bancoficticio.example", subject: "Estado de cuenta", receivedAt });
    mail.inject({ id: "second", from: "avisos@tiendaplaza.example", subject: "Recibimos tu pago", receivedAt });
    const original = console.error;
    console.error = () => {};
    try {
      await app.tick();
    } finally {
      console.error = original;
    }
    expect(app.store.senales().map((s) => s.origen.mailId)).toEqual(["second"]);
    expect(app.store.decisions()).toHaveLength(1);
  });
});
