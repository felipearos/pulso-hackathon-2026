import { describe, expect, test } from "bun:test";
import { migrate } from "../db";
import { createTestApp } from "../testing";

const NIGHT = new Date("2026-10-20T22:30:00-03:00");

describe("store", () => {
  test("a fresh app has exactly one Patricia, in etapa 1", () => {
    const { app } = createTestApp();
    expect(app.store.getPatricia()).toEqual({
      nombre: "Patricia",
      voz: null,
      gmailPermitido: false,
      etapa: 1,
      bolsillo: null,
      enPausa: false,
    });
  });

  test("a second Patricia cannot be inserted", () => {
    const { db } = createTestApp();
    expect(() => db.run("INSERT INTO patricia (id, nombre, etapa) VALUES (2, 'Otra', '1')")).toThrow();
    expect(() => db.run("INSERT INTO patricia (id, nombre, etapa) VALUES (1, 'Otra', '1')")).toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM patricia").get()).toEqual({ n: 1 });
  });

  test("updatePatricia changes only the given fields", () => {
    const { app } = createTestApp();
    const updated = app.store.updatePatricia({ bolsillo: "Para la mamá", gmailPermitido: true });
    expect(updated).toEqual({ ...app.store.getPatricia(), bolsillo: "Para la mamá", gmailPermitido: true });
    expect(app.store.getPatricia().nombre).toBe("Patricia");
    expect(app.store.getPatricia().enPausa).toBe(false);
  });

  test("setEtapa moves her and appends history with the clock time", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    app.store.setEtapa(2, "sube: respondió la cita de la etapa 1");
    const later = new Date("2026-10-22T22:30:00-03:00");
    clock.set(later);
    app.store.setEtapa("graduada", "se gradúa: abrió el estado de cuenta ella");

    expect(app.store.getPatricia().etapa).toBe("graduada");
    expect(app.store.etapaHistory()).toEqual([
      { at: NIGHT, from: 1, to: 2, motivo: "sube: respondió la cita de la etapa 1" },
      { at: later, from: 2, to: "graduada", motivo: "se gradúa: abrió el estado de cuenta ella" },
    ]);
  });

  test("estados de cuenta round-trip with the clock time", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const input = {
      origen: "banco" as const,
      ciclo: 7,
      fechaCierre: "2026-10-10",
      fechaVencimiento: "2026-10-25",
      cifras: {
        totalBilled: 850_000,
        monthlyRate: 0.031,
        minimumRule: { percent: 0.0645, floor: 10_000, roundTo: 100 },
      },
      pagoMinimo: 54_900,
    };
    const added = app.store.addEstadoDeCuenta(input);
    app.store.addEstadoDeCuenta({ ...input, origen: "tienda", cifras: null, fechaCierre: null, pagoMinimo: null });

    expect(added).toEqual({ id: added.id, ...input, receivedAt: NIGHT });
    const listed = app.store.estadosDeCuenta();
    expect(listed.map((e) => e.origen)).toEqual(["banco", "tienda"]);
    expect(listed[0]).toEqual(added);
    expect(listed[1]!.cifras).toBeNull();
  });

  test("señales round-trip with the clock time", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const origen = { mailId: "mail-1", from: "avisos@banco.example", subject: "Tu estado de cuenta" };
    const added = app.store.addSenal({ tipo: "S1", origen });
    app.store.addSenal({ tipo: "ignorado", origen: { ...origen, mailId: "mail-2" } });

    expect(added).toEqual({ id: added.id, tipo: "S1", origen, receivedAt: NIGHT });
    expect(app.store.senales().map((s) => s.tipo)).toEqual(["S1", "ignorado"]);
    expect(app.store.senales()[0]).toEqual(added);
  });

  test("mensajes salientes round-trip with the clock time", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const audio = {
      kind: "audio" as const,
      text: "Hola Patricia, hoy hay una buena noticia.",
      durationSeconds: 42,
      whatsappId: "wamid.1",
    };
    const added = app.store.addMensajeSaliente(audio);
    app.store.addMensajeSaliente({ kind: "text", text: "Buenas noches", durationSeconds: null, whatsappId: null });

    expect(added).toEqual({ id: added.id, ...audio, sentAt: NIGHT });
    expect(app.store.mensajesSalientes().map((m) => m.kind)).toEqual(["audio", "text"]);
    expect(app.store.mensajesSalientes()[0]).toEqual(added);
  });

  test("mensajes entrantes round-trip with the clock time and parsed intención", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const added = app.store.addMensajeEntrante({
      text: "me dio susto",
      intencion: { kind: "angustia", value: 4 },
      whatsappId: "wamid.2",
    });
    app.store.addMensajeEntrante({ text: "👍", intencion: null, whatsappId: null });

    expect(added).toEqual({
      id: added.id,
      text: "me dio susto",
      intencion: { kind: "angustia", value: 4 },
      whatsappId: "wamid.2",
      receivedAt: NIGHT,
    });
    expect(app.store.mensajesEntrantes().map((m) => m.intencion)).toEqual([{ kind: "angustia", value: 4 }, null]);
  });

  test("a decision records the clock time, tipo, motivo and parsed datos", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const datos = { etapa: 1, senales: [{ intencion: { kind: "accepted" }, citaEtapa: 1 }] };
    const decision = app.store.recordDecision({ tipo: "subir-etapa", motivo: "sube: respondió la cita", datos });

    expect(decision).toEqual({
      id: decision.id,
      at: NIGHT,
      tipo: "subir-etapa",
      motivo: "sube: respondió la cita",
      datos,
    });
    expect(app.store.decisions()).toEqual([decision]);
  });

  test("decisions cannot be edited or deleted", () => {
    const { app, db } = createTestApp();
    app.store.recordDecision({ tipo: "callar", motivo: "calla: su mamá está despierta", datos: { hora: "22:30" } });
    const before = app.store.decisions();

    expect(() => db.run("UPDATE decisions SET motivo = 'otro'")).toThrow();
    expect(() => db.run("DELETE FROM decisions")).toThrow();
    expect(app.store.decisions()).toEqual(before);
  });

  test("migrating the app's database again applies nothing", () => {
    const { db } = createTestApp();
    expect(migrate(db)).toEqual([]);
  });
});
