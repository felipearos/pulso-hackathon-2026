import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import type { OutgoingWhatsApp } from "../ports";
import { createTestApp, type TestApp } from "../testing";
import { CAPTION_IMAGEN } from "./envio";

const DRAFT = "Hola, Patricia. Estás al día, no estás en DICOM. Este mes el pago mínimo es $41.900.";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function setup({ etapa = 3, totalBilled = 650_000 }: { etapa?: 1 | 3; totalBilled?: number } = {}): TestApp {
  const t = createTestApp({
    now: parseSantiago("2026-10-19T09:00"),
    llm: [
      ["Escribe el guion", DRAFT],
      ["", "OK"],
    ],
  });
  // Estado de cuenta 8 from the case, as in `src/citas/envio.test.ts`.
  t.app.store.addEstadoDeCuenta({
    origen: "banco",
    ciclo: 8,
    fechaCierre: "2026-10-15",
    fechaVencimiento: "2026-11-05",
    cifras: {
      totalBilled,
      monthlyRate: 0.031,
      minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
      overdue: 0,
    },
    pagoMinimo: 41_900,
  });
  if (etapa === 3) t.app.store.setEtapa(3, "subió: ya mira el estado de cuenta");
  return t;
}

async function tickAt({ app, clock }: TestApp, at: string): Promise<void> {
  clock.set(parseSantiago(at));
  await app.tick();
}

function kinds(t: TestApp): OutgoingWhatsApp["kind"][] {
  return t.whatsapp.outbox.map((m) => m.kind);
}

function decisionsStarting(t: TestApp, prefix: string) {
  return t.app.store.decisions().filter((d) => d.motivo.startsWith(prefix));
}

describe("imagen difuminada of the etapa 3 cita", () => {
  test("follows the nota de voz with the blurred estado de cuenta", async () => {
    const t = setup();
    await tickAt(t, "2026-10-19T22:30");

    expect(kinds(t)).toEqual(["audio", "image"]);
    const image = t.whatsapp.outbox[1] as Extract<OutgoingWhatsApp, { kind: "image" }>;
    expect(image.mimeType).toBe("image/png");
    expect(image.caption).toBe(CAPTION_IMAGEN);
    expect(CAPTION_IMAGEN).not.toMatch(/\d/);
    expect(Array.from(image.image.subarray(0, 8))).toEqual(PNG_SIGNATURE);

    const mensajes = t.app.store.mensajesSalientes();
    expect(mensajes.map((m) => m.kind)).toEqual(["audio", "image"]);
    expect(mensajes[1]).toMatchObject({ kind: "image", text: CAPTION_IMAGEN, durationSeconds: null });

    const [sent] = decisionsStarting(t, "salió la imagen");
    expect(sent?.datos).toMatchObject({
      cifra: { kind: "pago-minimo", monto: 41_900 },
      recuadro: { x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) },
    });
  });

  test("an etapa 1 cita sends no image", async () => {
    const t = setup({ etapa: 1 });
    await tickAt(t, "2026-10-19T22:30");

    expect(kinds(t)).toEqual(["audio"]);
  });

  test("two ticks in the same minute send one image", async () => {
    const t = setup();
    await Promise.all([tickAt(t, "2026-10-19T22:30"), tickAt(t, "2026-10-19T22:30")]);
    await tickAt(t, "2026-10-19T22:30");

    expect(kinds(t)).toEqual(["audio", "image"]);
  });

  test("a failed image is recorded once and retried alone the same day", async () => {
    const t = setup();
    t.whatsapp.failNextImages = 2;
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-19T22:31");

    expect(kinds(t)).toEqual(["audio"]);
    expect(decisionsStarting(t, "no salió la imagen")).toHaveLength(1);

    await tickAt(t, "2026-10-19T22:32");
    expect(kinds(t)).toEqual(["audio", "image"]);
    expect(t.voice.calls).toHaveLength(1);

    await tickAt(t, "2026-10-19T22:33");
    expect(t.whatsapp.outbox).toHaveLength(2);
  });

  test("a retried image keeps the cifra of the audio she heard, not a newer estado de cuenta's", async () => {
    const t = setup();
    t.whatsapp.failNextImages = 1;
    await tickAt(t, "2026-10-19T22:30");
    t.app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 9,
      fechaCierre: "2026-11-15",
      fechaVencimiento: "2026-12-05",
      cifras: {
        totalBilled: 700_000,
        monthlyRate: 0.031,
        minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
        overdue: 0,
      },
      pagoMinimo: 45_200,
    });
    await tickAt(t, "2026-10-19T22:31");

    expect(kinds(t)).toEqual(["audio", "image"]);
    expect(decisionsStarting(t, "callo la imagen")).toHaveLength(0);
    expect(decisionsStarting(t, "salió la imagen")[0]?.datos).toMatchObject({
      cifra: { kind: "pago-minimo", monto: 41_900 },
    });
  });

  test("a restart still sends the image owed that night", async () => {
    const t = setup();
    t.whatsapp.failNextImages = 1;
    await tickAt(t, "2026-10-19T22:30");

    const restarted = createTestApp({ db: t.db, now: parseSantiago("2026-10-19T22:45") });
    await restarted.app.tick();
    expect(restarted.whatsapp.outbox.map((m) => m.kind)).toEqual(["image"]);
    expect(restarted.voice.calls).toHaveLength(0);
  });

  test("a failed image is not caught up the next day", async () => {
    const t = setup();
    t.whatsapp.failNextImages = 100;
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-19T23:59");

    t.whatsapp.failNextImages = 0;
    await tickAt(t, "2026-10-20T09:00");
    await tickAt(t, "2026-10-20T22:30");
    expect(t.whatsapp.outbox.filter((m) => m.kind === "image")).toHaveLength(0);
  });

  test("a pago mínimo that is not on the estado de cuenta withholds the image", async () => {
    // 6,45 % of $700.000 rounds to a minimum the PDF does not show.
    const t = setup({ totalBilled: 700_000 });
    await tickAt(t, "2026-10-19T22:30");
    await tickAt(t, "2026-10-19T22:31");

    expect(kinds(t)).toEqual(["audio"]);
    const callo = decisionsStarting(t, "callo la imagen");
    expect(callo).toHaveLength(1);
    expect(callo[0]?.datos).toMatchObject({ cifra: { kind: "pago-minimo" } });
  });
});
