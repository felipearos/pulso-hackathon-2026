import { describe, expect, spyOn, test } from "bun:test";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "../figures/fixtures/estado-de-cuenta-8";
import { estadoDeCuenta8Pdf, estadoDeCuenta8PdfCifrado, pdfDeTexto } from "../figures/fixtures/pdf";
import { createApp, type App } from "../app";
import { allowedFigures, decisionDeCita, redactarGuion } from "../citas/redactor";
import { openDatabase } from "../db";
import { FakeClock, FakeLlm, FakeMail, FakeVoice, FakeWeb, FakeWhatsApp } from "../fakes";
import type { Cita } from "../patricia/entities";
import { PATRICIA_RUT_FICTICIO } from "../patricia/fixtures";
import type { Llm } from "../ports";
import { createTestApp } from "../testing";
import { BANCO_FICTICIO_MINIMUM_RULE, TIENDA_PLAZA_MINIMUM_RULE, linkDelEstadoDeCuenta } from "./estado-de-cuenta";
import { SAMPLE_BANCO } from "./samples";

const receivedAt = new Date("2026-10-19T08:00:00-03:00");
const bank = "Banco Ficticio <avisos@bancoficticio.example>";

/** The reply the extractor's prompt asks for, carrying every figure of estado de cuenta 8. */
const FULL_REPLY = {
  pagoMinimo: 41900,
  totalFacturado: 650000,
  cupo: 800000,
  tasaMensualPorcentaje: 3.1,
  fechaVencimiento: "2026-11-05",
  fechaCierre: "2026-10-15",
  mora: 0,
  pagosAnteriores: [37000, 37700, 38500, 39200, 40000, 40700, 41300].map((monto) => ({ monto, aTiempo: true })),
  comprasEnCuotas: [
    { descripcion: "Refrigerador", cuotaActual: 10, cuotasTotales: 12 },
    { descripcion: "Zapatillas", cuotaActual: 3, cuotasTotales: 3 },
  ],
};

/** The test app with Patricia's «Permitir» given and the LLM answering `reply` for estado de cuenta 8. */
function createAllowedApp(reply?: object) {
  const testApp = createTestApp({
    llm: reply === undefined ? [] : [["Estado de cuenta:", JSON.stringify(reply)]],
  });
  testApp.app.store.updatePatricia({ gmailPermitido: true });
  return testApp;
}

function callarCifra(decisions: { tipo: string; datos: unknown }[]) {
  return decisions.filter((d) => d.tipo === "callar-cifra");
}

describe("extractEstadoDeCuenta", () => {
  test("an S1 mail with every figure is stored as an estado de cuenta with no callar-cifra", async () => {
    const { app, mail } = createAllowedApp(FULL_REPLY);
    mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    const extraccion = app.store.extraccionForMail("ec8");
    expect(extraccion?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
    const estados = app.store.estadosDeCuenta();
    expect(estados).toHaveLength(1);
    expect(estados[0]).toMatchObject({
      id: extraccion!.estadoDeCuentaId,
      origen: "banco",
      ciclo: 1,
      pagoMinimo: 41900,
      fechaVencimiento: "2026-11-05",
      fechaCierre: "2026-10-15",
      cifras: { totalBilled: 650000, monthlyRate: 0.031, minimumRule: BANCO_FICTICIO_MINIMUM_RULE, overdue: 0 },
    });
    expect(callarCifra(app.store.decisions())).toEqual([]);
  });

  test("a figure not found gets a callar-cifra decision and stays null", async () => {
    const { app, mail } = createAllowedApp({ ...FULL_REPLY, cupo: null, tasaMensualPorcentaje: null });
    mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    const extraccion = app.store.extraccionForMail("ec8")!;
    expect(extraccion.cifras.cupo).toBeNull();
    expect(extraccion.cifras.tasaMensual).toBeNull();
    const estado = app.store.estadosDeCuenta()[0]!;
    expect(estado.cifras).toBeNull();
    expect(estado.pagoMinimo).toBe(41900);

    const decisions = callarCifra(app.store.decisions());
    expect(decisions.map((d) => (d.datos as { campo: string }).campo)).toEqual(["cupo", "tasaMensual"]);
    expect(decisions[0]!.datos).toEqual({ campo: "cupo", mailId: "ec8", estadoDeCuentaId: estado.id });
    expect(app.store.decisions().find((d) => d.tipo === "callar-cifra")!.motivo).toBe(
      "Callo esta cifra: no encontré el cupo en el estado de cuenta del ciclo 1.",
    );
  });

  test("an LLM that fails twice stores nothing, so the mail can be read again", async () => {
    const { app, mail, llm } = createAllowedApp();
    const ec8 = mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    expect(llm.calls).toHaveLength(2);
    expect(app.store.extraccionForMail("ec8")).toBeNull();
    expect(app.store.estadosDeCuenta()).toHaveLength(0);
    expect(callarCifra(app.store.decisions())).toHaveLength(0);

    const answering = createAllowedApp(FULL_REPLY);
    await answering.app.receiveMail(ec8);
    expect(await answering.app.extractEstadoDeCuenta(ec8)).not.toBeNull();
  });

  test("an S1 mail Claude could not read is read again on the next tick", async () => {
    let down = true;
    const llm: Llm = {
      async complete() {
        if (down) throw new Error("claude is down");
        return JSON.stringify(FULL_REPLY);
      },
    };
    const ports = {
      clock: new FakeClock(receivedAt),
      mail: new FakeMail(),
      whatsapp: new FakeWhatsApp(),
      llm,
      voice: new FakeVoice(),
      web: new FakeWeb(),
      db: openDatabase(":memory:"),
    };
    const app = createApp(ports);
    app.store.updatePatricia({ gmailPermitido: true });
    ports.mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();
    expect(app.store.extraccionForMail("ec8")).toBeNull();

    down = false;
    await app.tick();
    expect(app.store.extraccionForMail("ec8")?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
    expect(app.store.estadosDeCuenta()).toHaveLength(1);

    await app.tick();
    expect(app.store.estadosDeCuenta()).toHaveLength(1);
  });

  test("a reply that every figure is missing from leaves nine callar-cifra", async () => {
    const empty = Object.fromEntries(Object.keys(FULL_REPLY).map((key) => [key, null]));
    const { app, mail } = createAllowedApp(empty);
    mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    const estado = app.store.estadosDeCuenta()[0]!;
    expect(estado.pagoMinimo).toBeNull();
    expect(estado.cifras).toBeNull();
    expect(callarCifra(app.store.decisions())).toHaveLength(9);
  });

  test("a mail that is not S1 never reaches the LLM", async () => {
    const { app, mail, llm } = createAllowedApp(FULL_REPLY);
    const pago = mail.inject({ id: "s5", from: "avisos@tiendaplaza.example", subject: "¡Recibimos tu pago!", receivedAt });
    await app.tick();

    expect(app.store.senalForMail("s5")?.tipo).toBe("S5");
    expect(await app.extractEstadoDeCuenta(pago)).toBeNull();
    expect(llm.calls).toEqual([]);
    expect(app.store.estadosDeCuenta()).toEqual([]);
  });

  test("extracting the same mail again returns the stored extraction without asking the LLM", async () => {
    const { app, mail, llm } = createAllowedApp(FULL_REPLY);
    const ec8 = mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();
    const first = app.store.extraccionForMail("ec8");

    expect(await app.extractEstadoDeCuenta(ec8)).toEqual(first);
    expect(llm.calls).toHaveLength(1);
    expect(app.store.estadosDeCuenta()).toHaveLength(1);
  });

  test("each new bank estado de cuenta is the next ciclo", async () => {
    const { app, mail } = createAllowedApp(FULL_REPLY);
    mail.inject({ id: "ec-a", from: bank, subject: "Tu estado de cuenta de septiembre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    mail.inject({ id: "ec-b", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    expect(app.store.estadosDeCuenta().map((e) => e.ciclo)).toEqual([1, 2]);
  });
});

const tienda = "Tienda Plaza <cuenta@tiendaplaza.example>";
const statementUrl = "https://www.tiendaplaza.example/cuenta/octubre";
/** A fictional Tienda Plaza statement page; the LLM reply below is what it carries. */
const STATEMENT_PAGE =
  "<html><body><h1>Tienda Plaza</h1><p>Estado de cuenta octubre. Total facturado $180.000. Pago mínimo $9.000.</p></body></html>";
const TIENDA_REPLY = {
  pagoMinimo: 9000,
  totalFacturado: 180000,
  cupo: 400000,
  tasaMensualPorcentaje: 3.5,
  fechaVencimiento: "2026-11-06",
  fechaCierre: "2026-10-16",
  mora: 0,
  pagosAnteriores: [],
  comprasEnCuotas: [],
};

/** The test app with «Permitir» given, the LLM answering `reply` and the web serving `web`. */
function createTiendaApp(reply: object = TIENDA_REPLY, web: Record<string, string> = { [statementUrl]: STATEMENT_PAGE }) {
  const testApp = createTestApp({ llm: [["Estado de cuenta:", JSON.stringify(reply)]], web });
  testApp.app.store.updatePatricia({ gmailPermitido: true });
  return testApp;
}

function injectTienda(mail: FakeMail, id: string, links: string[] = [statementUrl]) {
  return mail.inject({ id, from: tienda, subject: "Tu estado de cuenta Tienda Plaza", text: "", receivedAt, links });
}

describe("extractEstadoDeCuenta for an S2 mail", () => {
  test("an S2 mail's link is read and stored as the tienda's estado de cuenta", async () => {
    const { app, mail, llm } = createTiendaApp();
    injectTienda(mail, "tp1");
    await app.tick();

    expect(app.store.senalForMail("tp1")?.tipo).toBe("S2");
    const extraccion = app.store.extraccionForMail("tp1");
    expect(extraccion).not.toBeNull();
    const estados = app.store.estadosDeCuenta();
    expect(estados).toHaveLength(1);
    expect(estados[0]).toMatchObject({
      id: extraccion!.estadoDeCuentaId,
      origen: "tienda",
      ciclo: 1,
      pagoMinimo: 9000,
      fechaVencimiento: "2026-11-06",
      fechaCierre: "2026-10-16",
      cifras: { totalBilled: 180000, monthlyRate: 0.035, minimumRule: TIENDA_PLAZA_MINIMUM_RULE, overdue: 0 },
    });
    expect(llm.calls.some((c) => c.prompt.includes("Total facturado $180.000"))).toBe(true);
    // What the stage-4 gate of the escalera reads.
    expect(app.store.estadosDeCuenta().some((e) => e.origen === "tienda")).toBe(true);
  });

  test("only a link on the tienda's own domain is followed", async () => {
    const { app, mail, web } = createTiendaApp();
    // A look-alike domain already makes the mail S7, so these are allowed hosts that are not this tienda's link.
    injectTienda(mail, "tp1", ["https://bancoficticio.example/x", "http://www.tiendaplaza.example/y", statementUrl]);
    await app.tick();

    expect(app.store.senalForMail("tp1")?.tipo).toBe("S2");
    expect(web.calls).toEqual([statementUrl]);
    expect(app.store.estadosDeCuenta()).toHaveLength(1);
  });

  test("an S2 mail with no allowed link fetches nothing, stores nothing and is not retried", async () => {
    const { app, mail, web, llm } = createTiendaApp();
    injectTienda(mail, "tp1", ["https://bancoficticio.example/cuenta", "http://www.tiendaplaza.example/cuenta/octubre"]);
    await app.tick();
    await app.tick();

    expect(app.store.senalForMail("tp1")?.tipo).toBe("S2");
    expect(web.calls).toEqual([]);
    expect(llm.calls.filter((c) => c.prompt.startsWith("Estado de cuenta:"))).toEqual([]);
    expect(app.store.extraccionForMail("tp1")).toBeNull();
    expect(app.store.estadosDeCuenta()).toEqual([]);
  });

  test("a link that could not be fetched is read again on the next tick", async () => {
    const { app, mail, web } = createTiendaApp(TIENDA_REPLY, {});
    injectTienda(mail, "tp1");
    await app.tick();
    expect(web.calls).toEqual([statementUrl]);
    expect(app.store.estadosDeCuenta()).toEqual([]);

    web.documents.set(statementUrl, { contentType: "text/html; charset=utf-8", body: new TextEncoder().encode(STATEMENT_PAGE) });
    await app.tick();
    expect(app.store.extraccionForMail("tp1")).not.toBeNull();
    expect(app.store.estadosDeCuenta()).toHaveLength(1);

    await app.tick();
    expect(web.calls).toHaveLength(2);
  });

  test("the bank and the tienda count their own ciclos", async () => {
    const testApp = createTestApp({
      llm: [
        ["Tienda Plaza", JSON.stringify(TIENDA_REPLY)],
        ["Estado de cuenta:", JSON.stringify(FULL_REPLY)],
      ],
      web: { [statementUrl]: STATEMENT_PAGE },
    });
    const { app, mail } = testApp;
    app.store.updatePatricia({ gmailPermitido: true });
    injectTienda(mail, "tp1");
    mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    const ciclos = () => app.store.estadosDeCuenta().map((e) => [e.origen, e.ciclo]);
    expect(ciclos()).toEqual([
      ["tienda", 1],
      ["banco", 1],
    ]);

    injectTienda(mail, "tp2");
    await app.tick();
    expect(ciclos()).toEqual([
      ["tienda", 1],
      ["banco", 1],
      ["tienda", 2],
    ]);
  });

  test("a figure not found in the tienda's estado de cuenta gets a callar-cifra with the tienda wording", async () => {
    const { app, mail } = createTiendaApp({ ...TIENDA_REPLY, cupo: null });
    injectTienda(mail, "tp1");
    await app.tick();

    const decisions = callarCifra(app.store.decisions());
    expect(decisions.map((d) => (d.datos as { campo: string }).campo)).toEqual(["cupo"]);
    expect(app.store.decisions().find((d) => d.tipo === "callar-cifra")!.motivo).toBe(
      "Callo esta cifra: no encontré el cupo en el estado de cuenta de la tienda del ciclo 1.",
    );
  });
});

describe("linkDelEstadoDeCuenta", () => {
  test("a bank mail never yields a link, even one on the bank's own domain", () => {
    const mail = { id: "b1", from: bank, subject: "Estado de cuenta", text: "", receivedAt, links: ["https://bancoficticio.example/estado"] };
    expect(linkDelEstadoDeCuenta(mail)).toBeNull();
  });

  test("the tienda's mail yields its first link on the tienda's domain", () => {
    const mail = { id: "t1", from: tienda, subject: "Estado de cuenta", text: "", receivedAt, links: ["https://bancoficticio.example/x", statementUrl] };
    expect(linkDelEstadoDeCuenta(mail)?.href).toBe(statementUrl);
  });
});

describe("an S2 whose link keeps failing", () => {
  test("is tried five times and then given up", async () => {
    const { app, mail, web } = createTiendaApp(TIENDA_REPLY, {});
    injectTienda(mail, "tp-dead");
    for (let i = 0; i < 8; i++) await app.tick();

    expect(web.calls).toHaveLength(5);
    expect(app.store.estadosDeCuenta()).toEqual([]);
  });

  test("with no web port, nothing is stored and the app keeps running", async () => {
    const ports = {
      clock: new FakeClock(receivedAt),
      mail: new FakeMail(),
      whatsapp: new FakeWhatsApp(),
      llm: { complete: async () => JSON.stringify(TIENDA_REPLY) },
      voice: new FakeVoice(),
      db: openDatabase(":memory:"),
    };
    const app = createApp(ports);
    app.store.updatePatricia({ gmailPermitido: true });
    injectTienda(ports.mail, "tp-noweb");
    await app.tick();

    expect(app.store.senalForMail("tp-noweb")?.tipo).toBe("S2");
    expect(app.store.estadosDeCuenta()).toEqual([]);
  });
});

describe("an S1 with a PDF attachment", () => {
  const CLAVE = PATRICIA_RUT_FICTICIO.split("-")[0]!;
  const AVISO = "Tu estado de cuenta va adjunto. Tu contraseña es tu RUT sin guión ni dígito verificador.";
  const RULE_PROMPT = "Texto del correo del banco:";
  const EXTRACTOR_PROMPT = "Estado de cuenta:";

  function bankMailWithPdf(bytes: Uint8Array) {
    return {
      id: "ec8-pdf",
      from: bank,
      subject: "Tu estado de cuenta de octubre",
      text: AVISO,
      receivedAt,
      links: [],
      adjuntos: [{ nombre: "EECC.pdf", mimeType: "application/octet-stream", bytes }],
    };
  }

  /** The test app with the «Permitir» given, the rule answering `regla` (failing when null) and the extractor `FULL_REPLY`. */
  function createPdfApp(regla: object | null, rut: string | null = PATRICIA_RUT_FICTICIO, demoToken?: string) {
    const table: Array<[string, string]> = [[EXTRACTOR_PROMPT, JSON.stringify(FULL_REPLY)]];
    if (regla !== null) table.unshift([RULE_PROMPT, JSON.stringify(regla)]);
    const testApp = createTestApp({ llm: table, demoToken });
    testApp.app.store.updatePatricia({ gmailPermitido: true, rut });
    return testApp;
  }

  function noAbre(decisions: { tipo: string; motivo: string; datos: unknown }[]) {
    return decisions.filter((d) => d.tipo === "no-abre-estado-de-cuenta");
  }

  function extractorCalls(calls: { prompt: string }[]) {
    return calls.filter((c) => c.prompt.includes(EXTRACTOR_PROMPT));
  }

  test("with the RUT and rule rut-sin-dv, the extractor reads the PDF's text and the extraction is stored", async () => {
    const { app, mail, llm } = createPdfApp({ regla: "rut-sin-dv", n: null });
    mail.inject(bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE)));
    await app.tick();

    const [extractor] = extractorCalls(llm.calls);
    expect(extractor?.prompt).toContain("MONTO MÍNIMO A PAGAR");
    expect(extractor?.prompt).not.toContain(AVISO);
    expect(app.store.extraccionForMail("ec8-pdf")?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
    expect(app.store.estadosDeCuenta()).toHaveLength(1);
    expect(noAbre(app.store.decisions())).toEqual([]);
  });

  test("a rule call that fails once is asked again and the PDF still opens", async () => {
    let ruleCalls = 0;
    const llm: Llm = {
      async complete({ prompt }) {
        if (prompt.includes(RULE_PROMPT)) {
          ruleCalls += 1;
          if (ruleCalls === 1) throw new Error("claude is down");
          return JSON.stringify({ regla: "rut-sin-dv", n: null });
        }
        return JSON.stringify(FULL_REPLY);
      },
    };
    const ports = {
      clock: new FakeClock(receivedAt),
      mail: new FakeMail(),
      whatsapp: new FakeWhatsApp(),
      llm,
      voice: new FakeVoice(),
      web: new FakeWeb(),
      db: openDatabase(":memory:"),
    };
    const app = createApp(ports);
    app.store.updatePatricia({ gmailPermitido: true, rut: PATRICIA_RUT_FICTICIO });
    ports.mail.inject(bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE)));
    await app.tick();

    expect(ruleCalls).toBe(2);
    expect(app.store.extraccionForMail("ec8-pdf")?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
  });

  test("an S1 with no adjuntos still reads the mail's text", async () => {
    const { app, mail, llm } = createAllowedApp(FULL_REPLY);
    mail.inject({ id: "ec8", from: bank, subject: "Tu estado de cuenta de octubre", text: ESTADO_DE_CUENTA_8_TEXTO, receivedAt });
    await app.tick();

    expect(extractorCalls(llm.calls)[0]?.prompt).toBe(`Estado de cuenta:\n\n${ESTADO_DE_CUENTA_8_TEXTO}`);
  });

  test("rule sin-clave on a PDF with no clave reads it with no RUT stored", async () => {
    const { app, mail, llm } = createPdfApp({ regla: "sin-clave", n: null }, null);
    mail.inject(bankMailWithPdf(estadoDeCuenta8Pdf()));
    await app.tick();

    expect(extractorCalls(llm.calls)[0]?.prompt).toContain("MONTO MÍNIMO A PAGAR");
    expect(app.store.extraccionForMail("ec8-pdf")?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
  });

  test("no rule after the retry, on a PDF with no clave, reads it without one", async () => {
    const { app, mail, llm } = createPdfApp(null, null);
    mail.inject(bankMailWithPdf(estadoDeCuenta8Pdf()));
    await app.tick();

    expect(llm.calls.filter((c) => c.prompt.includes(RULE_PROMPT))).toHaveLength(2);
    expect(app.store.extraccionForMail("ec8-pdf")?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
  });

  const failures: Array<{ caso: string; regla: object | null; rut: string | null }> = [
    { caso: "sin-rut", regla: { regla: "rut-sin-dv", n: null }, rut: null },
    { caso: "clave-invalida", regla: { regla: "primeros-n", n: 12 }, rut: PATRICIA_RUT_FICTICIO },
    { caso: "clave-no-abre", regla: { regla: "rut-con-dv", n: null }, rut: PATRICIA_RUT_FICTICIO },
    { caso: "sin-clave-no-abre", regla: null, rut: PATRICIA_RUT_FICTICIO },
  ];
  for (const { caso, regla, rut } of failures) {
    test(`a PDF that does not open (${caso}) closes the mail with one decision and no figures`, async () => {
      const { app, mail, llm } = createPdfApp(regla, rut);
      mail.inject(bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE)));
      await app.tick();

      const decisions = noAbre(app.store.decisions());
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.datos).toEqual({ mailId: "ec8-pdf", caso });
      expect(decisions[0]!.motivo).not.toContain(CLAVE);
      expect(extractorCalls(llm.calls)).toEqual([]);
      expect(app.store.extraccionForMail("ec8-pdf")).toBeNull();
      expect(app.store.estadosDeCuenta()).toEqual([]);
    });
  }

  describe("a closed mail", () => {
    test("is not read again on the next tick", async () => {
      const { app, mail, llm } = createPdfApp({ regla: "rut-con-dv", n: null });
      mail.inject(bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE)));
      await app.tick();
      const calls = llm.calls.length;

      await app.tick();
      expect(llm.calls).toHaveLength(calls);
      expect(noAbre(app.store.decisions())).toHaveLength(1);
    });

    test("extracted twice gives one decision and no extra LLM call", async () => {
      const { app, mail, llm } = createPdfApp({ regla: "rut-con-dv", n: null });
      const ec8 = mail.inject(bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE)));
      await app.tick();
      const calls = llm.calls.length;

      expect(await app.extractEstadoDeCuenta(ec8)).toBeNull();
      expect(await app.extractEstadoDeCuenta(ec8)).toBeNull();
      expect(llm.calls).toHaveLength(calls);
      expect(noAbre(app.store.decisions())).toHaveLength(1);
    });

    test("two concurrent extractions share one run", async () => {
      const { app, llm } = createPdfApp({ regla: "rut-con-dv", n: null });
      const ec8 = bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE));
      await app.receiveMail(ec8);

      expect(await Promise.all([app.extractEstadoDeCuenta(ec8), app.extractEstadoDeCuenta(ec8)])).toEqual([null, null]);
      expect(llm.calls.filter((c) => c.prompt.includes(RULE_PROMPT))).toHaveLength(1);
      expect(noAbre(app.store.decisions())).toHaveLength(1);
    });

    test("injected again from /sala with its fixed id gives no second decision and no extra LLM call", async () => {
      const token = "token-de-sala";
      const { app, llm } = createPdfApp({ regla: "rut-con-dv", n: null }, PATRICIA_RUT_FICTICIO, token);
      const inject = () =>
        app.handle(new Request("http://localhost/sala/correos/banco", { method: "POST", headers: { "x-demo-token": token } }));
      expect((await inject()).ok).toBe(true);
      expect(noAbre(app.store.decisions())).toHaveLength(1);
      const calls = llm.calls.length;

      expect((await inject()).ok).toBe(true);
      expect(llm.calls).toHaveLength(calls);
      expect(noAbre(app.store.decisions())).toHaveLength(1);
    });
  });

  describe("after its PDF did not open", () => {
    test("the night's cita still goes out, without that figure", async () => {
      const { app, mail } = createPdfApp({ regla: "rut-sin-dv", n: null }, null);
      mail.inject(bankMailWithPdf(estadoDeCuenta8PdfCifrado(CLAVE)));
      await app.tick();
      expect(noAbre(app.store.decisions())).toHaveLength(1);

      // The estado de cuenta the cita sender picks (src/citas/envio.ts): the bank's latest with figures.
      const estadoDeCuenta =
        app.store.estadosDeCuenta().findLast((e) => e.origen === "banco" && e.cifras !== null) ?? null;
      expect(estadoDeCuenta).toBeNull();
      const cita: Cita = {
        id: 1,
        fecha: "2026-10-19",
        tipo: "lunes",
        estado: "programada",
        etapa: 1,
        motivo: "cita del lunes, etapa 1",
        pendientes: [],
        programadaAt: new Date("2026-10-19T23:00:00Z"),
        mensajeSalienteId: null,
      };
      const decision = decisionDeCita({ cita, estadoDeCuenta });
      expect(decision.cifra).toBeNull();
      expect(allowedFigures(decision.cifra).allowedFigures).toEqual([]);

      const llm = new FakeLlm([
        ["Escribe el guion", "Hola, Patricia. Estás al día, no estás en DICOM."],
        ["Respóndeme", "OK"],
      ]);
      const { guion } = await redactarGuion({ llm, decision, nombre: "Patricia", recordDecision: () => {} });
      expect(guion.endsWith(decision.pregunta)).toBe(true);
    });

    test("the RUT and the clave never leave Patricia's row", async () => {
      // The fictional RUT was chosen so its digits are not among estado de cuenta 8's figures.
      expect(JSON.stringify(ESTADO_DE_CUENTA_8_CIFRAS)).not.toContain(CLAVE);
      const [cuerpo, dv] = PATRICIA_RUT_FICTICIO.split("-") as [string, string];
      const conPuntos = `${cuerpo.slice(0, -6)}.${cuerpo.slice(-6, -3)}.${cuerpo.slice(-3)}`;
      const secrets = [PATRICIA_RUT_FICTICIO, CLAVE, `${cuerpo}${dv}`, conPuntos];
      // The bank prints her RUT on the estado de cuenta itself, as real ones do.
      const pdfConRut = pdfDeTexto(`TITULAR: PATRICIA RUT ${conPuntos}-${dv}\n${ESTADO_DE_CUENTA_8_TEXTO}`, CLAVE);

      const lines: string[] = [];
      const spies = (["log", "info", "warn", "error"] as const).map((level) =>
        spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        }),
      );
      const seen: string[] = [];
      try {
        for (const regla of [
          { regla: "rut-sin-dv", n: null },
          { regla: "rut-con-dv", n: null },
        ]) {
          const { app, mail, llm } = createPdfApp(regla);
          mail.inject(bankMailWithPdf(pdfConRut));
          await app.tick();
          seen.push(
            ...app.store.decisions().flatMap((d) => [d.motivo, JSON.stringify(d.datos)]),
            JSON.stringify(app.store.extraccionForMail("ec8-pdf")),
            JSON.stringify(app.store.estadosDeCuenta()),
            JSON.stringify(app.store.senales()),
            ...llm.calls.flatMap((c) => [c.prompt, c.system ?? ""]),
          );
          if (regla.regla === "rut-sin-dv") {
            expect(app.store.extraccionForMail("ec8-pdf")).not.toBeNull();
            // The PDF was read, with her RUT masked before the extractor saw it.
            expect(extractorCalls(llm.calls)[0]?.prompt).toContain("TITULAR: PATRICIA RUT [RUT]");
          }
          else expect(noAbre(app.store.decisions())).toHaveLength(1);
        }
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      // The closed mail's line was caught, so the spies saw the console.
      expect(lines.some((line) => line.includes("ec8-pdf"))).toBe(true);
      seen.push(...lines);

      for (const text of seen) for (const secret of secrets) expect(text).not.toContain(secret);
    });
  });

  describe("the real sample from /sala", () => {
    const token = "token-de-sala";
    const injectBanco = async (app: App) =>
      app.handle(new Request("http://localhost/sala/correos/banco", { method: "POST", headers: { "x-demo-token": token } }));
    const pdfLength = estadoDeCuenta8PdfCifrado(CLAVE).byteLength;

    test("with the RUT stored, its PDF is read and the extraction has every figure", async () => {
      const { app, llm } = createPdfApp({ regla: "rut-sin-dv", n: null }, PATRICIA_RUT_FICTICIO, token);
      expect((await injectBanco(app)).ok).toBe(true);

      expect(app.store.extraccionForMail(SAMPLE_BANCO.id)?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
      expect(extractorCalls(llm.calls)[0]?.prompt).toContain("MONTO MÍNIMO A PAGAR");
    });

    test("without a RUT, it is closed with one sin-rut decision and nothing stored", async () => {
      const { app } = createPdfApp({ regla: "rut-sin-dv", n: null }, null, token);
      expect((await injectBanco(app)).ok).toBe(true);

      const decisions = noAbre(app.store.decisions());
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.datos).toEqual({ mailId: SAMPLE_BANCO.id, caso: "sin-rut" });
      expect(app.store.extraccionForMail(SAMPLE_BANCO.id)).toBeNull();
      expect(app.store.estadosDeCuenta()).toEqual([]);
    });

    test("injected twice, the shared sample keeps its PDF's bytes", async () => {
      const first = createPdfApp({ regla: "rut-sin-dv", n: null }, PATRICIA_RUT_FICTICIO, token);
      expect((await injectBanco(first.app)).ok).toBe(true);
      expect((await injectBanco(first.app)).ok).toBe(true);
      expect(SAMPLE_BANCO.adjuntos![0]!.bytes.byteLength).toBe(pdfLength);

      // A second app opens the same bytes again: pdf.js did not detach them.
      const second = createPdfApp({ regla: "rut-sin-dv", n: null }, PATRICIA_RUT_FICTICIO, token);
      expect((await injectBanco(second.app)).ok).toBe(true);
      expect(second.app.store.extraccionForMail(SAMPLE_BANCO.id)?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
      expect(SAMPLE_BANCO.adjuntos![0]!.bytes.byteLength).toBe(pdfLength);
    });

    test("closed with no RUT, it is read after a reset and the RUT stored", async () => {
      const { app } = createPdfApp({ regla: "rut-sin-dv", n: null }, null, token);
      expect((await injectBanco(app)).ok).toBe(true);
      expect(noAbre(app.store.decisions())).toHaveLength(1);

      await app.reset();
      // The reset leaves the «Permitir» given and no RUT: she gives it again.
      expect(app.store.getPatricia()).toMatchObject({ gmailPermitido: true, rut: null });
      app.store.updatePatricia({ rut: PATRICIA_RUT_FICTICIO });
      expect((await injectBanco(app)).ok).toBe(true);

      expect(app.store.extraccionForMail(SAMPLE_BANCO.id)?.cifras).toEqual(ESTADO_DE_CUENTA_8_CIFRAS);
      expect(noAbre(app.store.decisions())).toEqual([]);
    });
  });
});
