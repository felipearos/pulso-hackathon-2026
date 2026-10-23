import { describe, expect, test } from "bun:test";
import { parseSantiago, santiagoDate, santiagoParts } from "./clock/santiago";
import { createTestApp } from "./testing";

const MINUTE_MS = 60 * 1000;

describe("createApp", () => {
  test("serves health through the assembled app", async () => {
    const { app } = createTestApp();
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("brings the schema up to date on creation", () => {
    const { db } = createTestApp();
    const table = db.query("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get();
    expect(table).toEqual({ name: "schema_migrations" });
  });

  test("tick runs with nothing scheduled and sends nothing", async () => {
    const { app, whatsapp } = createTestApp();
    await app.tick();
    expect(whatsapp.outbox).toEqual([]);
  });

  test("the control room's Monday night sends the test audio through the WhatsApp port", async () => {
    const { app, whatsapp } = createTestApp();
    const response = await app.handle(new Request("http://localhost/demo/moments/monday-night", { method: "POST" }));
    const body = (await response.json()) as { whatsapp: unknown };
    expect(body.whatsapp).toEqual({ sent: true, messageId: "wamid-1" });
    expect(whatsapp.outbox.map((message) => message.kind)).toEqual(["audio"]);
  });

  test("the fakes are wired in: the clock starts where asked and the LLM answers by table", async () => {
    const { clock, llm } = createTestApp({
      now: new Date("2026-10-23T22:30:00-03:00"),
      llm: [["buena noticia", "Pagaste más que el mínimo."]],
    });
    expect(clock.now().toISOString()).toBe("2026-10-24T01:30:00.000Z");
    expect(await llm.complete({ prompt: "Dame una buena noticia" })).toBe("Pagaste más que el mínimo.");
  });
});

describe("demo clock", () => {
  test("starts on the source's time", () => {
    const { app, clock } = createTestApp();
    expect(app.clock.now().toISOString()).toBe(clock.now().toISOString());
    expect(app.clock.isReal()).toBe(true);
  });

  test("set to jueves 22:30 keeps flowing with the source", () => {
    const { app, clock } = createTestApp();
    app.clock.set(parseSantiago("2026-10-22T22:30"));
    clock.advance(10 * MINUTE_MS);
    const parts = santiagoParts(app.clock.now());
    expect(app.clock.isReal()).toBe(false);
    expect([parts.weekday, parts.hour, parts.minute]).toEqual([4, 22, 40]);
  });

  test("advancing across midnight lands on Friday", () => {
    const { app } = createTestApp();
    app.clock.set(parseSantiago("2026-10-22T23:50"));
    app.clock.advance(20 * MINUTE_MS);
    const now = app.clock.now();
    const parts = santiagoParts(now);
    expect(santiagoDate(now)).toBe("2026-10-23");
    expect([parts.weekday, parts.hour, parts.minute]).toEqual([5, 0, 10]);
  });

  test("reset returns to the source's time", () => {
    const { app, clock } = createTestApp();
    app.clock.set(parseSantiago("2026-10-22T22:30"));
    app.clock.reset();
    expect(app.clock.now().toISOString()).toBe(clock.now().toISOString());
    expect(app.clock.isReal()).toBe(true);
  });

  test("the store stamps what it writes with the demo clock", () => {
    const { app } = createTestApp();
    const at = parseSantiago("2026-10-22T22:30");
    app.clock.set(at);
    const decision = app.store.recordDecision({ tipo: "callar", motivo: "calla: es tarde", datos: null });
    expect(decision.at.toISOString()).toBe(at.toISOString());
  });

  test("the offset survives a restart over the same database", () => {
    const first = createTestApp();
    first.app.clock.set(parseSantiago("2026-10-22T22:30"));
    const restarted = createTestApp({ now: first.clock.now(), db: first.db });
    expect(restarted.app.clock.now().toISOString()).toBe(first.app.clock.now().toISOString());
    expect(restarted.app.clock.isReal()).toBe(false);
  });
});
