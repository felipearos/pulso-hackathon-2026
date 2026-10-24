import { describe, expect, test } from "bun:test";
import { santiagoDate } from "../clock/santiago";
import { minimumPayment } from "../figures/payoff";
import { createTestApp } from "../testing";
import type { App } from "../app";
import {
  ESTADOS_DE_CUENTA,
  KEPT_TABLES,
  PATRICIA_AT_START,
  PATRICIA_START,
  RESET_TABLES,
  SENALES,
} from "./fixtures";

function resetApp() {
  const test = createTestApp();
  test.app.reset();
  return test;
}

function snapshot(app: App) {
  return {
    patricia: app.store.getPatricia(),
    etapaHistory: app.store.etapaHistory(),
    estadosDeCuenta: app.store.estadosDeCuenta(),
    senales: app.store.senales(),
    mensajesSalientes: app.store.mensajesSalientes(),
    mensajesEntrantes: app.store.mensajesEntrantes(),
    decisions: app.store.decisions(),
    now: app.clock.now(),
  };
}

describe("Patricia's story", () => {
  test("seven unopened estados de cuenta del banco and the eighth with a pago mínimo of 41.900", () => {
    const { app } = resetApp();
    const estados = app.store.estadosDeCuenta();
    expect(estados.map((estado) => [estado.origen, estado.ciclo])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((ciclo) => ["banco", ciclo]),
    );
    const eighth = estados[7]!;
    expect(eighth.cifras).toEqual({
      totalBilled: 650_000,
      monthlyRate: 0.031,
      minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
      overdue: 0,
    });
    expect(eighth.pagoMinimo).toBe(41_900);
    expect(santiagoDate(eighth.receivedAt)).toBe("2026-10-19");
    expect(eighth.receivedAt.getTime()).toBeLessThan(PATRICIA_START.getTime());
  });

  test("reset clears the RUT she gave", () => {
    const { app } = createTestApp();
    app.store.updatePatricia({ rut: "12345678-5" });
    app.reset();
    expect(app.store.getPatricia().rut).toBeNull();
  });

  test("reset clears her contexto, so the demo asks it from scratch", () => {
    const { app } = createTestApp();
    app.store.updatePatricia({ contexto: { deQueVive: "una pensión", queLePreocupa: null, queLePesa: null } });
    app.reset();
    expect(app.store.getPatricia().contexto).toBeNull();
  });

  test("every pago mínimo comes from its cifras and nothing is overdue", () => {
    const { app } = resetApp();
    for (const estado of app.store.estadosDeCuenta()) {
      expect(estado.cifras).not.toBeNull();
      expect(estado.pagoMinimo).toBe(minimumPayment(estado.cifras!.totalBilled, estado.cifras!.minimumRule));
      expect(estado.cifras!.overdue).toBe(0);
    }
  });

  test("each estado de cuenta del banco arrives with its S1", () => {
    const { app } = resetApp();
    const s1 = app.store.senales().filter((senal) => senal.tipo === "S1");
    expect(s1.map((senal) => senal.receivedAt)).toEqual(app.store.estadosDeCuenta().map((estado) => estado.receivedAt));
  });

  test("ciclos 1 to 7 are paid on time: an S5 on or before each vencimiento", () => {
    const { app } = resetApp();
    const s5 = app.store.senales().filter((senal) => senal.tipo === "S5");
    expect(s5).toHaveLength(7);
    for (const estado of app.store.estadosDeCuenta().slice(0, 7)) {
      const paid = s5.some(
        (senal) => senal.receivedAt > estado.receivedAt && santiagoDate(senal.receivedAt) <= estado.fechaVencimiento!,
      );
      expect(paid).toBe(true);
    }
  });

  test("pedidos del catálogo and the two compras en cuotas of the week are there", () => {
    const { app } = resetApp();
    const senales = app.store.senales();
    expect(senales.filter((senal) => senal.tipo === "S3").length).toBeGreaterThan(0);
    const s4 = senales.filter((senal) => senal.tipo === "S4");
    expect(s4.map((senal) => senal.origen.subject)).toEqual([
      expect.stringContaining("3 cuotas"),
      expect.stringContaining("6 cuotas"),
    ]);
  });

  test("she starts owed one bienvenida, which the first cita takes", () => {
    const { app } = resetApp();
    expect(app.store.pendientes().map(({ tipo, motivo }) => ({ tipo, motivo }))).toEqual([
      { tipo: "bienvenida", motivo: "su primera cita" },
    ]);
  });

  test("she starts at etapa 1 with no history, no messages, no decisions, at the start instant", () => {
    const { app } = resetApp();
    expect(app.store.getPatricia()).toEqual(PATRICIA_AT_START);
    expect(app.store.getPatricia().etapa).toBe(1);
    expect(app.store.etapaHistory()).toEqual([]);
    expect(app.store.mensajesSalientes()).toEqual([]);
    expect(app.store.mensajesEntrantes()).toEqual([]);
    expect(app.store.decisions()).toEqual([]);
    expect(app.clock.now().toISOString()).toBe(PATRICIA_START.toISOString());
  });
});

describe("no real data", () => {
  const story = JSON.stringify({ PATRICIA_AT_START, ESTADOS_DE_CUENTA, SENALES });

  test("every mail comes from a reserved .example domain", () => {
    for (const senal of SENALES) expect(senal.input.origen.from).toMatch(/@[\w.-]+\.example$/);
  });

  test("no phone number, RUT or account number appears in the story", () => {
    expect(story).not.toMatch(/\+?56\s?9/);
    expect(story).not.toMatch(/\d{8,}/);
    expect(story).not.toMatch(/\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/);
  });
});

describe("resetPatricia", () => {
  test("rows are stamped with their story time even while the source clock runs", () => {
    const { app, clock } = createTestApp();
    // Every read of the source is a millisecond later, as the system clock would be.
    let reads = 0;
    clock.now = () => new Date(PATRICIA_START.getTime() + ++reads);
    app.reset();
    expect(app.store.estadosDeCuenta().map((estado) => estado.receivedAt)).toEqual(
      ESTADOS_DE_CUENTA.map((event) => event.at),
    );
    expect(app.store.senales().map((senal) => senal.receivedAt)).toEqual(SENALES.map((event) => event.at));
  });

  test("two resets in a row give the same base, ids included", () => {
    const { app } = createTestApp();
    app.store.recordDecision({ tipo: "callar", motivo: "calla: es tarde", datos: null });
    app.store.addMensajeSaliente({ kind: "text", text: "Hola", durationSeconds: null, whatsappId: null });
    app.store.addMensajeEntrante({ text: "ya", intencion: null, whatsappId: null });
    app.store.setEtapa(3, "subió");
    app.store.updatePatricia({ bolsillo: "la alcancía", enPausa: true });
    app.clock.set(new Date("2026-10-22T22:30:00-03:00"));

    app.reset();
    const first = snapshot(app);
    app.reset();
    expect(snapshot(app)).toEqual(first);
    expect(first.estadosDeCuenta[0]!.id).toBe(1);
    expect(first.senales[0]!.id).toBe(1);
  });

  test("the decision log is still append-only after a reset", () => {
    const { app, db } = resetApp();
    app.store.recordDecision({ tipo: "callar", motivo: "calla: es tarde", datos: null });
    expect(() => db.run("DELETE FROM decisions")).toThrow("append-only");
    expect(() => db.run("UPDATE decisions SET motivo = 'otro'")).toThrow("append-only");
    expect(app.store.decisions()).toHaveLength(1);
  });

  test("a reset keeps the meta deliveries already taken in", () => {
    const { app } = createTestApp();
    expect(app.store.claimWhatsappId("wamid.ANTES")).toBe(true);

    app.reset();

    // Meta may still retry that delivery after the reset; it must stay a retry,
    // or the fresh story would take in a message from the old one.
    expect(app.store.claimWhatsappId("wamid.ANTES")).toBe(false);
  });

  test("every table is either wiped or deliberately kept by a reset", () => {
    const { db } = resetApp();
    const classified = new Set<string>([...RESET_TABLES, ...KEPT_TABLES]);
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables.filter((name) => !classified.has(name))).toEqual([]);
  });
});
