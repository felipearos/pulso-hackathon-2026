import { describe, expect, test } from "bun:test";
import { MOTIVO_RESPUESTA_BIENVENIDA } from "../citas/bienvenida-respuestas";
import { resetPatricia, PATRICIA_RUT_FICTICIO } from "../patricia/fixtures";
import { createTestApp } from "../testing";
import { primerosPasos, type PrimerPaso } from "./primeros-pasos";

const setup = () => {
  const testApp = createTestApp();
  resetPatricia(testApp.db, testApp.app.clock);
  return testApp;
};

const pasos = (store: ReturnType<typeof createTestApp>["app"]["store"], gmailLoginHint = false) =>
  primerosPasos(store, { permitirUrl: "https://demo.example/permitir", gmailLoginHint });

const paso = (result: PrimerPaso[], id: PrimerPaso["id"]): PrimerPaso => {
  const found = result.find((item) => item.id === id);
  if (found === undefined) throw new Error(`missing step ${id}`);
  return found;
};

describe("primerosPasos", () => {
  test("starts with six pending steps in order after reset", () => {
    const { app } = setup();

    expect(pasos(app.store)).toEqual([
      { id: "saludo", titulo: "Patricia escribe por primera vez", hecho: false, at: null, detalle: null },
      { id: "bienvenida", titulo: "Sale la bienvenida", hecho: false, at: null, detalle: null },
      {
        id: "respuesta",
        titulo: "Responde a la bienvenida",
        hecho: false,
        at: null,
        detalle: "nombre Patricia (sin dato) · hora sin responder · voz principal",
      },
      {
        id: "permitir",
        titulo: "Da el «Permitir» de Gmail",
        hecho: false,
        at: null,
        detalle: "https://demo.example/permitir · Google mostrará el selector de cuentas",
      },
      { id: "rut", titulo: "Da su RUT", hecho: false, at: null, detalle: "pendiente" },
      { id: "contexto", titulo: "Cuenta su contexto", hecho: false, at: null, detalle: null },
    ]);
  });

  test("marks the first incoming message and the sent bienvenida with their times", () => {
    const { app } = setup();
    app.clock.set(new Date("2026-10-19T10:00:00-03:00"));
    app.store.addMensajeEntrante({ text: "hola", intencion: null, whatsappId: null });
    const firstAt = app.clock.now().toISOString();
    app.clock.set(new Date("2026-10-19T10:01:00-03:00"));
    app.store.addMensajeEntrante({ text: "otra vez", intencion: null, whatsappId: null });

    const cita = app.store.addCita({
      fecha: "2026-10-19",
      tipo: "bienvenida",
      estado: "programada",
      etapa: 1,
      motivo: "bienvenida",
      pendienteIds: [],
    });
    if (cita === null) throw new Error("could not add bienvenida cita");
    app.clock.set(new Date("2026-10-19T10:02:00-03:00"));
    const saliente = app.store.addMensajeSaliente({
      kind: "audio",
      text: "Hola, Patricia",
      durationSeconds: 42,
      whatsappId: "audio-bienvenida",
    });
    app.store.markCitaSent(cita.id, saliente.id);

    const result = pasos(app.store);
    expect(paso(result, "saludo")).toMatchObject({ hecho: true, at: firstAt, detalle: null });
    expect(paso(result, "bienvenida")).toMatchObject({
      hecho: true,
      at: saliente.sentAt.toISOString(),
      detalle: "nota de voz de 42 s",
    });
  });

  test("shows the RUT as given without returning its digits", () => {
    const { app } = setup();
    app.store.updatePatricia({ rut: PATRICIA_RUT_FICTICIO });
    app.clock.set(new Date("2026-10-19T10:00:00-03:00"));
    const decision = app.store.recordDecision({ tipo: "permitir-rut", motivo: "Patricia dio su RUT", datos: {} });

    const result = pasos(app.store);
    const rut = paso(result, "rut");
    const rutDigits = PATRICIA_RUT_FICTICIO.replace("-", "");
    expect(rut).toMatchObject({ hecho: true, at: decision.at.toISOString(), detalle: "dado" });
    expect(JSON.stringify(rut)).not.toContain(PATRICIA_RUT_FICTICIO);
    expect(JSON.stringify(rut)).not.toContain(rutDigits);
    for (const detail of result.map((item) => item.detalle).filter((item): item is string => item !== null)) {
      expect(detail).not.toContain(PATRICIA_RUT_FICTICIO);
      expect(detail).not.toContain(rutDigits);
    }
  });

  test("shows the account selector choice without exposing an email address", () => {
    const { app } = setup();
    const selector = pasos(app.store, false);
    const direct = pasos(app.store, true);

    expect(paso(selector, "permitir").detalle).toContain("Google mostrará el selector de cuentas");
    expect(paso(direct, "permitir").detalle).toContain("va directo a la cuenta de Patricia");
    expect(JSON.stringify(selector)).not.toContain("@");
    expect(JSON.stringify(direct)).not.toContain("@");
  });

  test("uses the permitir-correo decision instead of gmailPermitido", () => {
    const { app } = setup();
    expect(app.store.getPatricia().gmailPermitido).toBe(true);
    expect(paso(pasos(app.store), "permitir")).toMatchObject({ hecho: false, at: null });

    app.clock.set(new Date("2026-10-19T10:00:00-03:00"));
    const decision = app.store.recordDecision({ tipo: "permitir-correo", motivo: "Patricia permitió la lectura", datos: {} });

    expect(paso(pasos(app.store), "permitir")).toMatchObject({ hecho: true, at: decision.at.toISOString() });
  });

  test("shows the name source, hour and voz from the bienvenida answer", () => {
    const { app } = setup();
    app.store.updatePatricia({ nombre: "Andrea", hora: "21:15", voz: "otra" });
    app.clock.set(new Date("2026-10-19T10:00:00-03:00"));
    const decision = app.store.recordDecision({
      tipo: "mensaje",
      motivo: `${MOTIVO_RESPUESTA_BIENVENIDA}: nombre`,
      datos: { respuestas: { nombre: "Andrea" } },
    });

    expect(paso(pasos(app.store), "respuesta")).toMatchObject({
      hecho: true,
      at: decision.at.toISOString(),
      detalle: "nombre Andrea (lo dijo ella) · hora 21:15 · voz otra",
    });
  });

  test("shows two answered contexto questions and their raw answers", () => {
    const { app } = setup();
    app.store.updatePatricia({
      contexto: { deQueVive: "vendo por catálogo", queLePreocupa: "quedar en DICOM", queLePesa: null },
    });
    const decision = app.store.recordDecision({ tipo: "contar-contexto", motivo: "Patricia contó su contexto", datos: {} });

    expect(paso(pasos(app.store), "contexto")).toMatchObject({
      hecho: true,
      at: decision.at.toISOString(),
      detalle: "2 de 3 preguntas · de qué vive: vendo por catálogo · qué le preocupa: quedar en DICOM",
    });
  });
});
