import { describe, expect, spyOn, test } from "bun:test";
import { createTestApp } from "../testing";

describe("mail poll error policy", () => {
  test("records one failure per run, logs recovery, and starts a new run after another failure", async () => {
    const { app, mail } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: true });
    let shouldFail = true;
    mail.fetchNew = async () => {
      if (shouldFail) throw new Error("mail service unavailable");
      return [];
    };
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await app.tick();
      await app.tick();
      await app.tick();

      expect(app.store.decisions().filter((decision) => decision.tipo === "error-correo")).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain("fetchNew failed");

      shouldFail = false;
      await app.tick();
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[1]?.[0]).toBe("mail: fetchNew is back after 3 failed polls");

      shouldFail = true;
      await app.tick();
      expect(app.store.decisions().filter((decision) => decision.tipo === "error-correo")).toHaveLength(2);
      expect(errorSpy).toHaveBeenCalledTimes(3);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("skips the mail port without permission and continues the tick after a poll failure", async () => {
    const { app, mail, clock } = createTestApp({ now: new Date("2026-10-23T04:30:00-03:00") });
    let fetchCalls = 0;
    mail.fetchNew = async () => {
      fetchCalls += 1;
      throw new Error("mail service unavailable");
    };

    await app.tick();
    expect(fetchCalls).toBe(0);

    app.store.updatePatricia({ gmailPermitido: true });
    const pendiente = app.store.addPendiente({ tipo: "bienvenida", motivo: "bienvenida inicial", datos: {} });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(app.tick()).resolves.toBeUndefined();
      expect(fetchCalls).toBe(1);
      expect(app.store.decisions().some((decision) => decision.tipo === "diferir")).toBe(true);
      expect(app.store.pendientes()[0]?.diferidoAt).toEqual(clock.now());
      expect(pendiente.id).toBeGreaterThan(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
