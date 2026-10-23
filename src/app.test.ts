import { describe, expect, test } from "bun:test";
import { createTestApp } from "./testing";

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
