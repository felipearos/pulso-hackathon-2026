import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { textoMinimoCoincide, textoMinimoDistinto } from "../figures/minimo-contado";
import type { Etapa } from "../escalera/policy";
import type { EstadoDeCuentaInput } from "../patricia/store";
import { createTestApp, TEST_WEBHOOK_CONFIG, type TestApp } from "../testing";

// #51: the foto Patricia sends of an estado de cuenta, and the mínimo she tells
// in etapa 5, driven the way Meta drives them: one signed POST to the assembled
// app, with a fictional payload.

const FROM = "56900000000";
const WEBHOOK_URL = "http://localhost/webhook/whatsapp";
const FOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };

/** One Meta delivery carrying one message from Patricia. */
function delivery(message: object): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "56900000001", phone_number_id: "1" },
              contacts: [{ profile: { name: "Patricia" }, wa_id: FROM }],
              messages: [message],
            },
          },
        ],
      },
    ],
  });
}

function textMessage(id: string, text: string): object {
  return { from: FROM, id, timestamp: "1792792800", type: "text", text: { body: text } };
}

function imageMessage(id: string, mediaId: string): object {
  return { from: FROM, id, timestamp: "1792792800", type: "image", image: { id: mediaId, mime_type: "image/jpeg" } };
}

function signedPost(body: string): Request {
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", TEST_WEBHOOK_CONFIG.appSecret).update(body).digest("hex")}`,
    },
    body,
  });
}

function estado(input: Pick<EstadoDeCuentaInput, "origen" | "ciclo" | "pagoMinimo">): EstadoDeCuentaInput {
  return { fechaCierre: null, fechaVencimiento: null, cifras: null, ...input };
}

/** An app whose extractor reads `pagoMinimo` on any foto, and whose tone review passes the mínimo answers. */
function setup(
  options: { pagoMinimo?: number | null; classify?: Array<[string, string]>; now?: Date } = {},
): TestApp {
  const t = createTestApp({
    ...(options.now ? { now: options.now } : {}),
    llm: [
      ["Foto de un estado de cuenta:", JSON.stringify({ pagoMinimo: options.pagoMinimo ?? null })],
      [/abriste tú/, "OK"],
      ...(options.classify ?? []),
    ],
  });
  t.whatsapp.media.set("media-foto-1", FOTO);
  return t;
}

/** Puts her in `etapa` with a cita of `tipo` as Luna's latest message. */
function citaSent(t: TestApp, etapa: Etapa, tipo: "lunes" | "jueves"): void {
  const { store } = t.app;
  store.setEtapa(etapa, "para la prueba");
  const cita = store.addCita({ fecha: "2026-10-19", tipo, estado: "programada", etapa, motivo: "para la prueba", pendienteIds: [] });
  const saliente = store.addMensajeSaliente({ kind: "audio", text: "la cita", durationSeconds: 40, whatsappId: "wamid.LUNA1" });
  store.markCitaSent(cita!.id, saliente.id);
}

async function send(t: TestApp, message: object): Promise<void> {
  const response = await t.app.handle(signedPost(delivery(message)));
  expect(response.status).toBe(200);
  await t.app.drain();
}

describe("a foto of an estado de cuenta, through the app factory", () => {
  test("in etapa 4, a foto whose mínimo matches the tienda's is celebrated", async () => {
    const t = setup({ pagoMinimo: 18500 });
    citaSent(t, 4, "jueves");
    t.app.store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 1, pagoMinimo: 18500 }));

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    expect(t.whatsapp.downloads).toEqual(["media-foto-1"]);
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: textoMinimoCoincide("tienda", 18500, "Patricia") }]);
  });

  test("in etapa 4, a foto whose mínimo differs is answered gently with only the tienda's figure", async () => {
    const t = setup({ pagoMinimo: 19000 });
    citaSent(t, 4, "jueves");
    t.app.store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 1, pagoMinimo: 18500 }));

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    const text = textoMinimoDistinto("tienda", 18500);
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(text).toContain("$18.500");
    expect(text).not.toContain("19");
  });

  test("with no bank estado de cuenta stored, the foto becomes one and its mínimo is celebrated", async () => {
    const t = setup({ pagoMinimo: 40100 });
    citaSent(t, 2, "jueves");

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    const estados = t.app.store.estadosDeCuenta();
    expect(estados).toHaveLength(1);
    expect(estados[0]).toMatchObject({ origen: "banco", pagoMinimo: 40100 });
    const text = textoMinimoCoincide("banco", 40100, "Patricia", false);
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(text).not.toContain("igual");
  });

  test("in etapa 5, a foto whose mínimo matches the bank's is celebrated", async () => {
    const t = setup({ pagoMinimo: 40100 });
    citaSent(t, 5, "lunes");
    t.app.store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 9, pagoMinimo: 40100 }));

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    expect(t.app.store.estadosDeCuenta()).toHaveLength(1);
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: textoMinimoCoincide("banco", 40100, "Patricia") }]);
  });

  test("in the madrugada a foto is still stored as an estado de cuenta, and Luna sends only the madrugada note", async () => {
    const t = setup({ pagoMinimo: 40100, now: new Date("2026-10-20T02:30:00-03:00") });
    citaSent(t, 2, "jueves");

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    expect(t.app.store.estadosDeCuenta()).toEqual([expect.objectContaining({ origen: "banco", pagoMinimo: 40100 })]);
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio"]);
  });

  test("the foto's entrante is accepted without the clasificador, and the registro says it came as a foto", async () => {
    const t = setup({ pagoMinimo: 18500 });
    citaSent(t, 4, "jueves");
    t.app.store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 1, pagoMinimo: 18500 }));

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    const entrantes = t.app.store.mensajesEntrantes();
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0]).toMatchObject({
      text: "[foto del estado de cuenta: pago mínimo $18.500]",
      intencion: { kind: "accepted" },
      whatsappId: "wamid.FOTO1",
    });
    const move = t.app.store.decisions().find((d) => d.datos !== null && typeof d.datos === "object" && "move" in d.datos);
    expect(move?.datos).toMatchObject({ whatsappId: "wamid.FOTO1", arrival: { from: FROM, kind: "image" } });
    // The extractor and the tone review of the answer: no clasificador.
    expect(t.llm.calls).toHaveLength(2);
  });

  test("a foto with no pago mínimo legible gets the calm answer, without figures", async () => {
    const t = createTestApp({
      llm: [
        ["Foto de un estado de cuenta:", JSON.stringify({ pagoMinimo: null })],
        ["No alcancé a ver bien tu foto", "OK"],
      ],
    });
    t.whatsapp.media.set("media-foto-1", FOTO);
    citaSent(t, 4, "jueves");

    await send(t, imageMessage("wamid.FOTO1", "media-foto-1"));

    expect(t.app.store.mensajesEntrantes()[0]?.text).toBe("[foto del estado de cuenta, sin pago mínimo legible]");
    expect(t.whatsapp.outbox).toHaveLength(1);
    expect(t.whatsapp.outbox[0]).toMatchObject({ kind: "text" });
    expect(JSON.stringify(t.whatsapp.outbox[0])).not.toMatch(/\d/);
  });
});

describe("the mínimo Patricia tells in etapa 5, through the app factory", () => {
  const CLASSIFY: Array<[string, string]> = [["el mínimo es", '{"intencion":"other"}']];

  test("a mínimo that matches the bank's is celebrated", async () => {
    const t = setup({ classify: CLASSIFY });
    citaSent(t, 5, "lunes");
    t.app.store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));

    await send(t, textMessage("wamid.TEXT1", "el mínimo es 40.100"));

    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: textoMinimoCoincide("banco", 40100, "Patricia") }]);
  });

  test("a mínimo that differs is corrected gently with only the bank's figure", async () => {
    const t = setup({ classify: CLASSIFY });
    citaSent(t, 5, "lunes");
    t.app.store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));

    await send(t, textMessage("wamid.TEXT1", "el mínimo es 41.000"));

    const text = textoMinimoDistinto("banco", 40100);
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(text).toContain("$40.100");
    expect(text).not.toContain("41");
  });

  test("a figure answering any other cita is not taken as the mínimo", async () => {
    const t = setup({ classify: CLASSIFY });
    citaSent(t, 5, "jueves");
    t.app.store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));

    await send(t, textMessage("wamid.TEXT1", "el mínimo es 40.100"));

    expect(t.whatsapp.outbox).toEqual([]);
  });
});
