import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import { createTestApp, type TestApp } from "../testing";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const STEP_MS = 15 * MINUTE_MS;

const LLM: Array<[string, string]> = [
  ["Escribe el guion", "Hola, Patricia. Qué bueno escucharte de nuevo. Estás al día. ¿Cómo estás hoy?"],
  ["pausa", '{"intencion":"pause"}'],
  ["hola", '{"intencion":"hello"}'],
];

function setup(): TestApp {
  return createTestApp({ llm: LLM });
}

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

function toEtapa4(t: TestApp): void {
  for (const etapa of [2, 3, 4] as const) t.app.store.setEtapa(etapa, "subió: prueba");
}

function bankEstado(t: TestApp, ciclo: number): void {
  t.app.store.addEstadoDeCuenta({
    origen: "banco",
    ciclo,
    fechaCierre: "2026-11-15",
    fechaVencimiento: "2026-12-05",
    cifras: null,
    pagoMinimo: null,
  });
}

function ofTipo(t: TestApp, tipo: string) {
  return t.app.store.decisions().filter((d) => d.tipo === tipo);
}

describe("pausa", () => {
  test("«pausa» silences Luna: no goodbye and every slot callada for three weeks", async () => {
    const t = setup();

    const move = await t.app.receiveMensaje({ text: "pausa", whatsappId: null });

    expect(move).toEqual({ kind: "stay", from: 1, to: 1, reason: "en pausa: pidió pausa" });
    expect(t.app.store.getPatricia().enPausa).toBe(true);
    const [pausa] = ofTipo(t, "pausa");
    expect(pausa?.motivo).toBe("en pausa: pidió pausa");
    expect(pausa?.datos).toEqual({ desde: t.clock.now().toISOString(), text: "pausa" });

    await tickUntil(t, "2026-11-09T09:00");
    expect(t.whatsapp.outbox).toEqual([]);
    const citas = t.app.store.citas();
    expect(citas).toHaveLength(9);
    expect(citas.every((c) => c.estado === "callada")).toBe(true);
  });

  test("14 days without a reply after a cita put her in pausa on its own; 13 do not", async () => {
    const t = setup();
    await tickUntil(t, "2026-10-19T22:30");
    expect(t.whatsapp.outbox).toHaveLength(1);

    await tickAt(t, "2026-11-01T22:30");
    expect(t.app.store.getPatricia().enPausa).toBe(false);
    expect(ofTipo(t, "pausa")).toEqual([]);
    const sent = t.whatsapp.outbox.length;

    await tickAt(t, "2026-11-02T22:30");
    expect(t.app.store.getPatricia().enPausa).toBe(true);
    const [pausa] = ofTipo(t, "pausa");
    expect(pausa?.motivo).toBe("en pausa: 14 días sin respuesta");
    expect(pausa?.datos).toEqual({ desde: parseSantiago("2026-10-19T22:30").toISOString() });
    expect(t.whatsapp.outbox).toHaveLength(sent);
    expect(t.app.store.citaOn("2026-11-02")?.estado).toBe("callada");
  });

  test("back after five weeks in etapa 4: one cycle down and a bienvenida de vuelta as audio", async () => {
    const t = setup();
    toEtapa4(t);
    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });
    t.clock.advance(35 * DAY_MS);

    const move = await t.app.receiveMensaje({ text: "hola", whatsappId: null });

    const reason = "vuelve en la etapa 3: perdió 1 ciclo de estado de cuenta";
    expect(move).toEqual({ kind: "down", from: 4, to: 3, reason });
    expect(t.app.store.getPatricia()).toMatchObject({ etapa: 3, enPausa: false });
    const [vuelta] = ofTipo(t, "vuelta");
    expect(vuelta?.motivo).toBe(reason);
    expect(vuelta?.datos).toMatchObject({ text: "hola", missedCycles: 1, from: 4, to: 3 });
    expect(ofTipo(t, "quedarse")).toEqual([]);
    expect(t.whatsapp.outbox).toEqual([]);

    await tickUntil(t, "2026-11-23T22:30");
    expect(t.app.store.citaOn("2026-11-23")).toMatchObject({ tipo: "bienvenida-de-vuelta", estado: "programada" });
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);
  });

  test("each bank estado de cuenta during the pausa is a missed cycle", async () => {
    const t = setup();
    toEtapa4(t);
    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });
    t.clock.advance(7 * DAY_MS);
    bankEstado(t, 9);
    t.clock.advance(14 * DAY_MS);
    bankEstado(t, 10);
    t.clock.advance(14 * DAY_MS);

    const move = await t.app.receiveMensaje({ text: "hola", whatsappId: null });

    expect(move).toMatchObject({ kind: "down", from: 4, to: 2 });
    expect(ofTipo(t, "vuelta")[0]?.datos).toMatchObject({ missedCycles: 2 });
  });

  test("never below etapa 1", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });
    t.clock.advance(DAY_MS);
    bankEstado(t, 9);
    bankEstado(t, 10);
    t.clock.advance(DAY_MS);

    const move = await t.app.receiveMensaje({ text: "hola", whatsappId: null });

    expect(move).toMatchObject({ kind: "stay", from: 1, to: 1 });
    expect(t.app.store.getPatricia()).toMatchObject({ etapa: 1, enPausa: false });
  });

  test("«hola» at 02:30 after a pausa sends nothing; the next cita is the bienvenida de vuelta", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });
    t.clock.set(parseSantiago("2026-10-27T02:30"));

    await t.app.receiveMensaje({ text: "hola", whatsappId: null });
    await t.app.tick();

    expect(t.whatsapp.outbox).toEqual([]);
    expect(t.app.store.pendientes().map((p) => p.tipo)).toEqual(["bienvenida-de-vuelta"]);
    await tickUntil(t, "2026-10-29T22:30");
    expect(t.app.store.citaOn("2026-10-29")).toMatchObject({ tipo: "bienvenida-de-vuelta", estado: "programada" });
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);
  });

  test("«pausa» while in pausa keeps her paused and logs nothing new", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });
    t.clock.advance(DAY_MS);
    const before = t.app.store.decisions().length;

    await t.app.receiveMensaje({ text: "pausa", whatsappId: null });

    expect(t.app.store.getPatricia().enPausa).toBe(true);
    expect(t.app.store.decisions()).toHaveLength(before);
    expect(ofTipo(t, "vuelta")).toEqual([]);
  });
});
