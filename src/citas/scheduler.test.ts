import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { createTestApp, type TestApp } from "../testing";

const MINUTE_MS = 60 * 1000;
const STEP_MS = 15 * MINUTE_MS;

/** Ticks every 15 minutes from the clock's current time up to and including `until`. */
async function tickUntil({ app, clock }: TestApp, until: string): Promise<void> {
  const end = parseSantiago(until).getTime();
  while (clock.now().getTime() <= end) {
    await app.tick();
    clock.advance(STEP_MS);
  }
}

async function tickAt({ app, clock }: TestApp, at: string): Promise<void> {
  clock.set(parseSantiago(at));
  await app.tick();
}

function summary(t: TestApp) {
  return t.app.store.citas().map(({ fecha, tipo, estado }) => ({ fecha, tipo, estado }));
}

describe("cita scheduler", () => {
  test("a week of ticks sets the lunes, jueves and domingo citas", async () => {
    const t = createTestApp();
    await tickUntil(t, "2026-10-26T09:00");
    expect(summary(t)).toEqual([
      { fecha: "2026-10-19", tipo: "lunes", estado: "programada" },
      { fecha: "2026-10-22", tipo: "jueves", estado: "programada" },
      { fecha: "2026-10-25", tipo: "domingo", estado: "programada" },
    ]);
    // The sender logs a "mensaje" decision for each cita it sends; only the scheduler's count here.
    const decisions = t.app.store.decisions().filter((d) => d.tipo !== "mensaje");
    expect(decisions.map((d) => d.tipo)).toEqual(["programar-cita", "programar-cita", "programar-cita"]);
    expect(decisions[0]!.motivo).toBe("cita del lunes, etapa 1");
  });

  test("never more than three programada citas in a week", async () => {
    const t = createTestApp();
    const { store } = t.app;
    for (const [fecha, tipo] of [
      ["2026-10-19", "lunes"],
      ["2026-10-20", "bienvenida"],
      ["2026-10-22", "jueves"],
    ] as const) {
      store.addCita({ fecha, tipo, estado: "programada", etapa: 1, motivo: "sembrada", pendienteIds: [] });
    }
    await tickAt(t, "2026-10-25T21:30");
    expect(store.citaOn("2026-10-25")).toMatchObject({ tipo: "domingo", estado: "callada" });
    expect(store.decisions().map(({ tipo, motivo }) => ({ tipo, motivo }))).toEqual([
      { tipo: "callar", motivo: "ya van tres citas esta semana" },
    ]);
  });

  test("a pendiente in the madrugada is deferred once and waits for the jueves cita", async () => {
    const t = createTestApp();
    const { store } = t.app;
    t.clock.set(parseSantiago("2026-10-20T01:00"));
    const pendiente = store.addPendiente({ tipo: "preocupacion", motivo: "dijo que le preocupa la cuota", datos: {} });
    await t.app.tick();
    await tickAt(t, "2026-10-20T05:31");
    t.clock.set(parseSantiago("2026-10-20T05:45"));
    await tickUntil(t, "2026-10-21T23:45");
    expect(store.citas()).toEqual([]);
    const diferidas = store.decisions().filter((d) => d.tipo === "diferir");
    expect(diferidas.map(({ motivo, datos }) => ({ motivo, datos }))).toEqual([
      { motivo: "diferido por madrugada", datos: { pendienteIds: [pendiente.id] } },
    ]);

    await tickUntil(t, "2026-10-22T22:30");
    const jueves = store.citaOn("2026-10-22");
    expect(jueves).toMatchObject({ tipo: "jueves", estado: "programada" });
    expect(jueves!.pendientes.map((p) => p.id)).toEqual([pendiente.id]);
    expect(store.decisions().filter((d) => d.tipo === "diferir")).toHaveLength(1);
  });

  test("two ticks in the same minute set one cita", async () => {
    const t = createTestApp();
    await tickAt(t, "2026-10-19T22:30");
    await t.app.tick();
    expect(t.app.store.citas()).toHaveLength(1);
    expect(t.app.store.decisions().filter((d) => d.tipo === "programar-cita")).toHaveLength(1);
  });

  test("a late tick still sets the day's cita, but a missed day is not caught up", async () => {
    const late = createTestApp();
    await tickAt(late, "2026-10-19T23:50");
    expect(summary(late)).toEqual([{ fecha: "2026-10-19", tipo: "lunes", estado: "programada" }]);

    const missed = createTestApp();
    await tickAt(missed, "2026-10-20T00:10");
    await tickAt(missed, "2026-10-20T10:00");
    expect(missed.app.store.citas()).toEqual([]);
    expect(missed.app.store.decisions()).toEqual([]);
  });

  test("in pausa every slot is decided callada", async () => {
    const t = createTestApp();
    t.app.store.updatePatricia({ enPausa: true });
    await tickUntil(t, "2026-10-26T09:00");
    expect(summary(t)).toEqual([
      { fecha: "2026-10-19", tipo: "lunes", estado: "callada" },
      { fecha: "2026-10-22", tipo: "jueves", estado: "callada" },
      { fecha: "2026-10-25", tipo: "domingo", estado: "callada" },
    ]);
    expect(t.app.store.decisions().map(({ tipo, motivo }) => ({ tipo, motivo }))).toEqual(
      Array(3).fill({ tipo: "callar", motivo: "en pausa: Luna no habla" }),
    );
  });

  test("a bienvenida pendiente makes the next cita a bienvenida", async () => {
    const t = createTestApp();
    const pendiente = t.app.store.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: {} });
    await tickUntil(t, "2026-10-19T22:30");
    const cita = t.app.store.citaOn("2026-10-19");
    expect(cita).toMatchObject({ tipo: "bienvenida", estado: "programada", motivo: "bienvenida" });
    expect(cita!.pendientes.map((p) => p.id)).toEqual([pendiente.id]);
    expect(t.app.store.decisions().findLast((d) => d.tipo === "programar-cita")!.datos).toEqual({
      citaId: cita!.id,
      tipo: "bienvenida",
      fecha: "2026-10-19",
      pendienteIds: [pendiente.id],
    });
  });

  test("the bienvenida goes out once, even with a second one waiting", async () => {
    const t = createTestApp();
    t.app.store.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: {} });
    await tickAt(t, "2026-10-19T22:30");
    const otra = t.app.store.addPendiente({ tipo: "bienvenida", motivo: "otra bienvenida", datos: {} });
    await tickAt(t, "2026-10-22T22:30");
    const jueves = t.app.store.citaOn("2026-10-22");
    expect(jueves).toMatchObject({ tipo: "jueves", estado: "programada" });
    expect(jueves!.pendientes.map((p) => p.id)).toEqual([otra.id]);
    expect(t.app.store.citas().filter((c) => c.tipo === "bienvenida")).toHaveLength(1);
  });

  test("a bienvenida de vuelta wins over a bienvenida still waiting", async () => {
    const t = createTestApp();
    t.app.store.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: {} });
    t.app.store.addPendiente({ tipo: "bienvenida-de-vuelta", motivo: "volvió de la pausa", datos: {} });
    await tickAt(t, "2026-10-19T22:30");
    expect(t.app.store.citaOn("2026-10-19")).toMatchObject({ tipo: "bienvenida-de-vuelta", estado: "programada" });
    expect(t.app.store.pendientes()).toEqual([]);
  });

  test("graduada, a month of ticks sets one graduada cita", async () => {
    const t = createTestApp({ now: parseSantiago("2026-11-01T00:00") });
    t.app.store.setEtapa("graduada", "terminó la escalera");
    await tickUntil(t, "2026-11-30T23:45");
    expect(summary(t)).toEqual([{ fecha: "2026-11-02", tipo: "graduada", estado: "programada" }]);
    expect(
      t.app.store
        .decisions()
        .filter((d) => d.tipo !== "mensaje")
        .map((d) => d.tipo),
    ).toEqual(["programar-cita"]);
  });

  test("graduada, a first lunes missed in pausa is not made up later in the month", async () => {
    const t = createTestApp({ now: parseSantiago("2026-11-01T00:00") });
    t.app.store.setEtapa("graduada", "terminó la escalera");
    t.app.store.updatePatricia({ enPausa: true });
    await tickUntil(t, "2026-11-03T09:00");
    t.app.store.updatePatricia({ enPausa: false });
    await tickUntil(t, "2026-11-30T23:45");
    expect(summary(t)).toEqual([{ fecha: "2026-11-02", tipo: "graduada", estado: "callada" }]);
  });
});
