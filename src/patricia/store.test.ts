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
      hora: null,
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

  test("her bienvenida answers are kept", () => {
    const { app } = createTestApp();
    app.store.updatePatricia({ nombre: "Paty", hora: "21:30", voz: "otra" });
    expect(app.store.getPatricia()).toMatchObject({ nombre: "Paty", hora: "21:30", voz: "otra" });
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

  test("an extraction round-trips by its mail, one per mail", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const estado = app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 8,
      fechaCierre: null,
      fechaVencimiento: null,
      cifras: null,
      pagoMinimo: null,
    });
    const cifras = {
      pagoMinimo: 41_900,
      totalFacturado: 650_000,
      cupo: null,
      tasaMensual: 0.031,
      fechaVencimiento: "2026-11-05",
      fechaCierre: "2026-10-15",
      mora: 0,
      pagosAnteriores: [{ monto: 41_300, aTiempo: true }],
      comprasEnCuotas: [{ descripcion: "Refrigerador", cuotasRestantes: 2 }],
    };
    const added = app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "mail-8", cifras });

    expect(added).toEqual({ id: added.id, estadoDeCuentaId: estado.id, mailId: "mail-8", cifras, extractedAt: NIGHT });
    expect(app.store.extraccionForMail("mail-8")).toEqual(added);
    expect(app.store.extraccionForMail("mail-9")).toBeNull();
    expect(() => app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "mail-8", cifras })).toThrow();
  });

  test("an estado de cuenta's extraction is found by its id, the latest if more than one", () => {
    const { app } = createTestApp();
    const input = { origen: "banco" as const, ciclo: 8, fechaCierre: "2026-10-15", fechaVencimiento: "2026-11-05" };
    const estado = app.store.addEstadoDeCuenta({ ...input, cifras: null, pagoMinimo: null });
    const sinExtraccion = app.store.addEstadoDeCuenta({ ...input, ciclo: 9, cifras: null, pagoMinimo: null });
    const cifras = {
      pagoMinimo: 41_900,
      totalFacturado: 650_000,
      cupo: null,
      tasaMensual: 0.031,
      fechaVencimiento: "2026-11-05",
      fechaCierre: "2026-10-15",
      mora: 0,
      pagosAnteriores: [],
      comprasEnCuotas: [],
    };
    app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "mail-8", cifras });
    const latest = app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "mail-8b", cifras });

    expect(app.store.extraccionForEstadoDeCuenta(estado.id)).toEqual(latest);
    expect(app.store.extraccionForEstadoDeCuenta(sinExtraccion.id)).toBeNull();
  });

  test("señales round-trip with the clock time", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const origen = { mailId: "mail-1", from: "avisos@banco.example", subject: "Tu estado de cuenta" };
    const added = app.store.addSenal({ tipo: "S1", origen });
    app.store.addSenal({ tipo: "ignorado", origen: { ...origen, mailId: "mail-2" } });

    expect(added).toEqual({ id: added.id, tipo: "S1", origen, monto: null, receivedAt: NIGHT });
    expect(app.store.senales().map((s) => s.tipo)).toEqual(["S1", "ignorado"]);
    expect(app.store.senales()[0]).toEqual(added);
  });

  test("a mail becomes at most one señal", () => {
    const { app } = createTestApp();
    const origen = { mailId: "mail-1", from: "avisos@banco.example", subject: "Tu estado de cuenta" };
    expect(app.store.senalForMail("mail-1")).toBeNull();
    const added = app.store.addSenal({ tipo: "S1", origen });

    expect(app.store.senalForMail("mail-1")).toEqual(added);
    expect(() => app.store.addSenal({ tipo: "S5", origen })).toThrow();
    expect(app.store.senales()).toHaveLength(1);
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

  test("pendientes wait until a cita takes them", () => {
    const { app, clock } = createTestApp();
    clock.set(NIGHT);
    const pendiente = app.store.addPendiente({
      tipo: "preocupacion",
      motivo: "le preocupa la cuota de la tienda",
      datos: { texto: "la cuota de la tienda" },
    });
    expect(pendiente).toEqual({
      id: pendiente.id,
      tipo: "preocupacion",
      motivo: "le preocupa la cuota de la tienda",
      datos: { texto: "la cuota de la tienda" },
      createdAt: NIGHT,
      diferidoAt: null,
      citaId: null,
    });

    const cita = app.store.addCita({
      fecha: "2026-10-20",
      tipo: "lunes",
      estado: "programada",
      etapa: 1,
      motivo: "cita del lunes",
      pendienteIds: [pendiente.id],
    });
    expect(cita).toEqual({
      id: cita!.id,
      fecha: "2026-10-20",
      tipo: "lunes",
      estado: "programada",
      etapa: 1,
      motivo: "cita del lunes",
      pendientes: [{ ...pendiente, citaId: cita!.id }],
      programadaAt: NIGHT,
      mensajeSalienteId: null,
    });
    expect(app.store.pendientes()).toEqual([]);
    expect(app.store.citaOn("2026-10-20")).toEqual(cita);
    expect(app.store.citaOn("2026-10-21")).toBeNull();
  });

  test("a day holds one cita: a second one is refused and takes no pendientes", () => {
    const { app } = createTestApp();
    const base = { fecha: "2026-10-20", estado: "programada" as const, etapa: 1 as const, motivo: "cita" };
    expect(app.store.addCita({ ...base, tipo: "lunes", pendienteIds: [] })).not.toBeNull();
    const pendiente = app.store.addPendiente({ tipo: "bienvenida", motivo: "su primera cita", datos: null });

    expect(app.store.addCita({ ...base, tipo: "bienvenida", pendienteIds: [pendiente.id] })).toBeNull();
    expect(app.store.citas()).toHaveLength(1);
    expect(app.store.pendientes()).toEqual([pendiente]);
  });

  test("markCitaSent stamps the mensaje saliente once", () => {
    const { app } = createTestApp();
    const cita = app.store.addCita({
      fecha: "2026-10-20",
      tipo: "lunes",
      estado: "programada",
      etapa: 1,
      motivo: "cita del lunes",
      pendienteIds: [],
    })!;
    const first = app.store.addMensajeSaliente({ kind: "audio", text: "hola", durationSeconds: 3, whatsappId: "w1" });
    const second = app.store.addMensajeSaliente({ kind: "audio", text: "hola", durationSeconds: 3, whatsappId: "w2" });

    expect(app.store.markCitaSent(cita.id, first.id)).toBe(true);
    expect(app.store.markCitaSent(cita.id, second.id)).toBe(false);
    expect(app.store.citaOn("2026-10-20")!.mensajeSalienteId).toBe(first.id);
  });

  test("deferPendientes keeps the first madrugada time", () => {
    const { app, clock } = createTestApp();
    const pendiente = app.store.addPendiente({ tipo: "senal", motivo: "llegó el estado de cuenta", datos: null });
    const first = new Date("2026-10-21T01:00:00-03:00");
    clock.set(first);
    app.store.deferPendientes([pendiente.id]);
    clock.set(new Date("2026-10-21T02:00:00-03:00"));
    app.store.deferPendientes([pendiente.id]);

    expect(app.store.pendientes()[0]!.diferidoAt).toEqual(first);
  });

  test("a whatsapp id is claimed once, and the claim survives a restart", () => {
    const { app, db } = createTestApp();
    expect(app.store.claimWhatsappId("wamid.AAA")).toBe(true);
    expect(app.store.claimWhatsappId("wamid.AAA")).toBe(false);
    expect(app.store.claimWhatsappId("wamid.BBB")).toBe(true);

    // The same file, as a deploy or a crash would reopen it.
    const { app: restarted } = createTestApp({ db });
    expect(restarted.store.claimWhatsappId("wamid.AAA")).toBe(false);
  });

  test("a released whatsapp id can be claimed again", () => {
    const { app } = createTestApp();
    expect(app.store.claimWhatsappId("wamid.AAA")).toBe(true);

    app.store.releaseWhatsappId("wamid.AAA");
    expect(app.store.claimWhatsappId("wamid.AAA")).toBe(true);

    // Releasing one that was never claimed is not an error.
    expect(() => app.store.releaseWhatsappId("wamid.NOPE")).not.toThrow();
  });

  test("migrating the app's database again applies nothing", () => {
    const { db } = createTestApp();
    expect(migrate(db)).toEqual([]);
  });
});
