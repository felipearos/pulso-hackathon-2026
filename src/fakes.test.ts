import { describe, expect, test } from "bun:test";
import { FakeClock, FakeLlm, FakeMail, FakeVoice, FakeWhatsApp } from "./fakes";

describe("FakeClock", () => {
  test("starts at the given date", () => {
    const clock = new FakeClock(new Date("2026-10-23T09:00:00-03:00"));
    expect(clock.now().toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });

  test("now returns a copy", () => {
    const clock = new FakeClock(new Date("2026-10-23T12:00:00Z"));
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });

  test("does not share the start date", () => {
    const start = new Date("2026-10-23T12:00:00Z");
    const clock = new FakeClock(start);
    start.setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });

  test("set and advance move time", () => {
    const clock = new FakeClock(new Date("2026-10-23T12:00:00Z"));
    clock.set(new Date("2026-11-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-11-01T00:00:00.000Z");
    clock.advance(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-11-01T01:30:00.000Z");
  });
});

describe("FakeMail", () => {
  const receivedAt = new Date("2026-10-23T12:00:00Z");
  const senders = ["example.com"];

  test("fills defaults for omitted fields", async () => {
    const mail = new FakeMail();
    mail.inject({ from: "banco@example.com", subject: "Estado de cuenta", receivedAt });
    mail.inject({ id: "custom", from: "a@example.com", subject: "b", receivedAt, text: "hola", links: ["https://example.com"] });
    mail.inject({ from: "c@example.com", subject: "d", receivedAt });
    const fetched = await mail.fetchNew(senders);
    expect(fetched).toEqual([
      { id: "mail-1", from: "banco@example.com", subject: "Estado de cuenta", text: "", receivedAt, links: [] },
      { id: "custom", from: "a@example.com", subject: "b", text: "hola", receivedAt, links: ["https://example.com"] },
      { id: "mail-2", from: "c@example.com", subject: "d", text: "", receivedAt, links: [] },
    ]);
  });

  test("fetchNew drains what was injected since the last call", async () => {
    const mail = new FakeMail();
    mail.inject({ from: "a@example.com", subject: "uno", receivedAt });
    expect((await mail.fetchNew(senders)).map((m) => m.subject)).toEqual(["uno"]);
    expect(await mail.fetchNew(senders)).toEqual([]);
    mail.inject({ from: "a@example.com", subject: "dos", receivedAt });
    expect((await mail.fetchNew(senders)).map((m) => m.subject)).toEqual(["dos"]);
  });

  test("fetchNew returns only mails from the given sender domains and drops the rest", async () => {
    const mail = new FakeMail();
    mail.inject({ from: "Banco <aviso@BancoAndino.example>", subject: "uno", receivedAt });
    mail.inject({ from: "amiga@correo.example", subject: "dos", receivedAt });
    mail.inject({ from: "aviso@bancoandino.example.otro", subject: "tres", receivedAt });
    expect((await mail.fetchNew(["bancoandino.example"])).map((m) => m.subject)).toEqual(["uno"]);
    expect(await mail.fetchNew(["correo.example"])).toEqual([]);
  });
});

describe("FakeWhatsApp", () => {
  test("records when Patricia wrote, which is what opens Meta's window", () => {
    const whatsapp = new FakeWhatsApp();
    const at = new Date("2026-10-23T23:10:00Z");
    whatsapp.recordInbound(at);
    at.setUTCFullYear(2000);
    expect(whatsapp.inbound).toEqual([new Date("2026-10-23T23:10:00Z")]);
  });

  test("records every message in order and returns sequential ids", async () => {
    const whatsapp = new FakeWhatsApp();
    const image = new Uint8Array([1, 2]);
    const first = await whatsapp.send({ kind: "text", text: "Hola Patricia" });
    const second = await whatsapp.send({ kind: "image", image, mimeType: "image/png", caption: "Tu cuenta" });
    expect(first).toEqual({ id: "wamid-1" });
    expect(second).toEqual({ id: "wamid-2" });
    expect(whatsapp.outbox).toEqual([
      { kind: "text", text: "Hola Patricia" },
      { kind: "image", image, mimeType: "image/png", caption: "Tu cuenta" },
    ]);
  });
});

describe("FakeLlm", () => {
  test("returns the reply of the first matching row", async () => {
    const llm = new FakeLlm([
      [/pago m[ií]nimo/, "regex reply"],
      ["estado de cuenta", "substring reply"],
      ["cuenta", "later reply"],
    ]);
    expect(await llm.complete({ prompt: "Resume el estado de cuenta" })).toBe("substring reply");
    expect(await llm.complete({ system: "sé breve", prompt: "Explica el pago mínimo de la cuenta" })).toBe("regex reply");
    expect(llm.calls).toEqual([
      { prompt: "Resume el estado de cuenta" },
      { system: "sé breve", prompt: "Explica el pago mínimo de la cuenta" },
    ]);
  });

  test("throws quoting the prompt when nothing matches", async () => {
    const llm = new FakeLlm([["cuenta", "reply"]]);
    await expect(llm.complete({ prompt: "Algo sin coincidencia" })).rejects.toThrow("Algo sin coincidencia");
    expect(llm.calls).toEqual([{ prompt: "Algo sin coincidencia" }]);
  });
});

describe("FakeVoice", () => {
  test("returns short ogg audio and records texts", async () => {
    const voice = new FakeVoice();
    const spoken = await voice.synthesize("Buenas noches, Patricia");
    expect(spoken.mimeType).toBe("audio/ogg");
    expect(spoken.audio.length).toBeGreaterThan(0);
    expect(spoken.durationSeconds).toBeGreaterThan(0);
    expect(voice.calls).toEqual(["Buenas noches, Patricia"]);
  });
});
