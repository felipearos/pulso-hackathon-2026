import { describe, expect, test } from "bun:test";
import { ESTADO_DE_CUENTA_8_CIFRAS, ESTADO_DE_CUENTA_8_TEXTO } from "../figures/fixtures/estado-de-cuenta-8";
import { createTestApp } from "../testing";
import { BANCO_ANDINO_MINIMUM_RULE } from "./estado-de-cuenta";

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
    answering.app.receiveMail(ec8);
    expect(await answering.app.extractEstadoDeCuenta(ec8)).not.toBeNull();
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
