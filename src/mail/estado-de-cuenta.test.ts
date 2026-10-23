import { describe, expect, test } from "bun:test";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "../figures/fixtures/estado-de-cuenta-8";
import { createApp } from "../app";
import { openDatabase } from "../db";
import { FakeClock, FakeMail, FakeVoice, FakeWeb, FakeWhatsApp } from "../fakes";
import type { Llm } from "../ports";
import { createTestApp } from "../testing";
import { BANCO_ANDINO_MINIMUM_RULE, TIENDA_PLAZA_MINIMUM_RULE } from "./estado-de-cuenta";

const receivedAt = new Date("2026-10-19T08:00:00-03:00");
const bank = "Banco Andino <avisos@bancoandino.example>";

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
      cifras: { totalBilled: 650000, monthlyRate: 0.031, minimumRule: BANCO_ANDINO_MINIMUM_RULE, overdue: 0 },
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
    injectTienda(mail, "tp1", ["https://bancoandino.example/x", "http://www.tiendaplaza.example/y", statementUrl]);
    await app.tick();

    expect(app.store.senalForMail("tp1")?.tipo).toBe("S2");
    expect(web.calls).toEqual([statementUrl]);
    expect(app.store.estadosDeCuenta()).toHaveLength(1);
  });

  test("an S2 mail with no allowed link fetches nothing, stores nothing and is not retried", async () => {
    const { app, mail, web, llm } = createTiendaApp();
    injectTienda(mail, "tp1", ["https://bancoandino.example/cuenta", "http://www.tiendaplaza.example/cuenta/octubre"]);
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
