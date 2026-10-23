import { describe, expect, test } from "bun:test";
import { santiagoParts } from "../clock/santiago";
import { PATRICIA_START } from "../patricia/fixtures";
import type { App } from "../app";
import type { TipoSenal } from "../patricia/entities";
import { createTestApp, type TestApp } from "../testing";
import type { Hold } from "../fakes";

const TOKEN = "operador-secreto-de-prueba";

const get = (app: App, path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));
const post = (app: App, path: string, headers: Record<string, string> = { "x-demo-token": TOKEN }) =>
  app.handle(new Request(`http://localhost${path}`, { method: "POST", headers }));

/** Patricia's state without row ids, which a reset may renumber. */
const snapshot = (app: App) => {
  const strip = <T extends { id: number }>(rows: T[]) => rows.map(({ id: _id, ...rest }) => rest);
  return {
    now: app.clock.now().toISOString(),
    patricia: app.store.getPatricia(),
    etapas: app.store.etapaHistory(),
    estados: strip(app.store.estadosDeCuenta()),
    senales: strip(app.store.senales()),
    decisiones: strip(app.store.decisions()),
    citas: app.store.citas(),
    pendientes: app.store.pendientes(),
    salientes: app.store.mensajesSalientes(),
    entrantes: app.store.mensajesEntrantes(),
  };
};

describe("/sala without the operator token", () => {
  const paths: [string, string][] = [
    ["GET", "/sala"],
    ["GET", "/sala/state"],
    ["POST", "/sala/tick"],
    ["POST", "/sala/reset"],
    ["POST", "/sala/momentos/jue-2230"],
    ["GET", "/sala/conversacion"],
    ["GET", "/sala/simulador/media/sim-out-1"],
    ["POST", "/sala/simulador"],
    ["POST", "/sala/simulador/mensaje"],
    ["POST", "/sala/correos/banco"],
  ];

  test("every endpoint answers 404 when no token is configured, whatever is sent", async () => {
    const { app } = createTestApp();
    for (const [method, path] of paths) {
      const response = await app.handle(
        new Request(`http://localhost${path}?token=`, { method, headers: { "x-demo-token": "" } }),
      );
      expect([method, path, response.status]).toEqual([method, path, 404]);
    }
  });

  test("every endpoint answers 404 without the token or with a wrong one", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    for (const [method, path] of paths) {
      const attempts: Record<string, string>[] = [{}, { "x-demo-token": "otro" }, { "x-demo-token": `${TOKEN}x` }];
      for (const headers of attempts) {
        const response = await app.handle(new Request(`http://localhost${path}`, { method, headers }));
        expect([method, path, response.status]).toEqual([method, path, 404]);
      }
    }
  });

  test("a wrong token changes nothing", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    const before = snapshot(app);
    await post(app, "/sala/momentos/jue-2230", { "x-demo-token": "otro" });
    await post(app, "/sala/reset", {});
    expect(snapshot(app)).toEqual(before);
  });
});

describe("/sala with the operator token", () => {
  test("serves the control room page with the token in the query", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const response = await get(app, `/sala?token=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Sala de control");
  });

  test("the control room page calls every /sala endpoint with the token header", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const page = await (await get(app, `/sala?token=${TOKEN}`)).text();
    for (const reference of [
      "/sala/state",
      "/sala/momentos/",
      "/sala/reset",
      "/sala/tick",
      "/sala/conversacion",
      "/sala/simulador",
      "/sala/simulador/mensaje",
      "/sala/correos/",
      "x-demo-token",
    ]) {
      expect(page).toContain(reference);
    }
  });

  test("state lists the momentos of the guion from configuration", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const response = await get(app, "/sala/state", { "x-demo-token": TOKEN });
    const body = (await response.json()) as { guion: { id: string; label: string }[] };
    expect(response.status).toBe(200);
    expect(body.guion.map((momento) => momento.id)).toContain("jue-2230");
  });

  test("«Jue 22:30» moves the clock to Thursday 22:30 and its tick sets that night's cita", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    const response = await post(app, "/sala/momentos/jue-2230");
    expect(response.status).toBe(200);
    const parts = santiagoParts(app.clock.now());
    expect([parts.weekday, parts.hour, parts.minute]).toEqual([4, 22, 30]);
    expect(app.store.citaOn("2026-10-22")).toMatchObject({ fecha: "2026-10-22", estado: "programada" });
  });

  test("tick runs with the token in the query alone, even beside an empty header", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    app.clock.set(new Date("2026-10-23T01:30:00Z"));
    const response = await post(app, `/sala/tick?token=${TOKEN}`, { "x-demo-token": "" });
    expect(response.status).toBe(200);
    expect(app.store.citaOn("2026-10-22")).toMatchObject({ estado: "programada" });
  });

  test("a malformed momento id is refused", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    expect((await post(app, "/sala/momentos/%E0")).status).toBe(400);
  });

  test("an unknown momento is refused and leaves the clock alone", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    const response = await post(app, "/sala/momentos/viernes");
    expect(response.status).toBe(400);
    expect(app.clock.now().toISOString()).toBe(PATRICIA_START.toISOString());
  });

  test("reset leaves the base as the fixture load does", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const { app: fresh } = createTestApp();
    fresh.reset();
    app.reset();
    await post(app, "/sala/momentos/lun-2230");
    await post(app, "/sala/momentos/jue-2230");
    expect(snapshot(app)).not.toEqual(snapshot(fresh));
    const response = await post(app, "/sala/reset");
    expect(response.status).toBe(200);
    expect(snapshot(app)).toEqual(snapshot(fresh));
  });

  test("other paths still reach the app's own routes", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    expect((await get(app, "/health")).status).toBe(200);
    expect((await get(app, "/salami", { "x-demo-token": TOKEN })).status).toBe(404);
  });

  test("the scripted /demo room keeps answering beside /sala", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const response = await get(app, "/demo");
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("x-demo-token");
  });
});

/** What Claude answers for the sample bank mail's estado de cuenta; fictional figures. */
const BANCO_REPLY = {
  pagoMinimo: 41900,
  totalFacturado: 650000,
  cupo: 800000,
  tasaMensualPorcentaje: 3.1,
  fechaVencimiento: "2026-11-05",
  fechaCierre: "2026-10-15",
  mora: 0,
  pagosAnteriores: [],
  comprasEnCuotas: [],
};

type Correo = { at: string; tipo: string; subject: string; from: string; etiqueta: string };

describe("/sala sample mails", () => {
  const createMailApp = () => {
    const testApp = createTestApp({ demoToken: TOKEN, llm: [["Estado de cuenta:", JSON.stringify(BANCO_REPLY)]] });
    // Gmail is not allowed: the sample mails do not depend on her «Permitir».
    expect(testApp.app.store.getPatricia().gmailPermitido).toBe(false);
    return testApp;
  };

  test("each sample mail becomes its señal through the app's mail flow", async () => {
    const { app } = createMailApp();
    const expected: [string, TipoSenal][] = [
      ["banco", "S1"],
      ["tienda", "S2"],
      ["pedido", "S3"],
      ["cuotas", "S4"],
      ["pago", "S5"],
      ["falso", "S7"],
      ["publicidad", "ignorado"],
    ];
    for (const [kind, tipo] of expected) {
      const response = await post(app, `/sala/correos/${kind}`);
      expect([kind, response.status]).toEqual([kind, 200]);
      const { correos } = (await response.json()) as { correos: Correo[] };
      expect([kind, correos.at(-1)?.tipo]).toEqual([kind, tipo]);
      expect(correos.at(-1)?.at).toBe(app.clock.now().toISOString());
    }
    expect(app.store.senales().map((senal) => senal.tipo)).toEqual(expected.map(([, tipo]) => tipo));
  });

  test("the falso is labelled sospechoso and the publicidad ignorado", async () => {
    const { app } = createMailApp();
    await post(app, "/sala/correos/falso");
    const { correos } = (await (await post(app, "/sala/correos/publicidad")).json()) as { correos: Correo[] };
    expect(correos.map(({ tipo, etiqueta }) => [tipo, etiqueta])).toEqual([
      ["S7", "sospechoso"],
      ["ignorado", "ignorado"],
    ]);
  });

  test("the bank sample's estado de cuenta is read as tick reads it", async () => {
    const { app, llm } = createMailApp();
    await post(app, "/sala/correos/banco");
    expect(llm.calls.some((call) => call.prompt.includes("Estado de cuenta:"))).toBe(true);
    expect(app.store.extraccionForMail("muestra-banco-estado")).not.toBeNull();
    expect(app.store.estadosDeCuenta()).toHaveLength(1);
  });

  test("an unknown kind or an inherited property name is refused", async () => {
    const { app } = createMailApp();
    for (const kind of ["otro", "toString", "__proto__", "%E0%A4%A"]) {
      const response = await post(app, `/sala/correos/${kind}`);
      expect([kind, response.status]).toEqual([kind, 400]);
    }
    expect(app.store.senales()).toEqual([]);
  });
});

describe("/sala reset while a tick is running", () => {
  const LUN = "/sala/momentos/lun-2230";
  const JUE = "/sala/momentos/jue-2230";

  /** Patricia right after a reset, with no tick since. */
  const freshSnapshot = async () => {
    const { app } = createTestApp();
    await app.reset();
    return snapshot(app);
  };

  /** The app reset and at Monday 22:30, the night of the bienvenida. */
  const atBienvenida = async () => {
    const t = createTestApp({ demoToken: TOKEN });
    await t.app.reset();
    t.app.clock.set(new Date("2026-10-20T01:30:00Z"));
    return t;
  };

  /** The app past the bienvenida and at Thursday 22:30, a cita the redactor writes. */
  const atJueves = async () => {
    const t = createTestApp({ demoToken: TOKEN });
    await t.app.reset();
    expect((await post(t.app, LUN)).status).toBe(200);
    t.app.clock.set(new Date("2026-10-23T01:30:00Z"));
    return t;
  };

  /**
   * Starts a tick that stops at `hold`, asks for a reset while it waits, then
   * releases it. Returns the outbox length when the reset answered.
   */
  const raceReset = async (t: TestApp, hold: Hold, startTick: () => Promise<unknown> = () => t.app.tick()) => {
    const ticking = startTick();
    await hold.reached;
    let outboxAtReset = -1;
    const resetting = Promise.resolve(post(t.app, "/sala/reset")).then((response) => {
      outboxAtReset = t.whatsapp.outbox.length;
      return response;
    });
    hold.release();
    const [ticked, reset] = await Promise.all([ticking, resetting]);
    return { ticked, reset, outboxAtReset };
  };

  test("nothing from the old story arrives after the reset answered", async () => {
    const t = await atBienvenida();
    const hold = t.voice.holdSynthesis();
    const { ticked, reset, outboxAtReset } = await raceReset(t, hold);
    expect(ticked).toBeUndefined();
    expect(reset.status).toBe(200);
    expect(t.whatsapp.outbox.length).toBeGreaterThan(0);
    expect(t.whatsapp.outbox.length).toBe(outboxAtReset);
  });

  test("a tick asked for through /sala/tick answers 200 when a reset lands in it", async () => {
    const t = await atBienvenida();
    const hold = t.voice.holdSynthesis();
    const { ticked, reset, outboxAtReset } = await raceReset(t, hold, async () => post(t.app, "/sala/tick"));
    expect((ticked as Response).status).toBe(200);
    expect(reset.status).toBe(200);
    expect(t.whatsapp.outbox.length).toBe(outboxAtReset);
  });

  test("a tick held in the redactor writes nothing into the new story", async () => {
    const t = await atJueves();
    const sentBefore = t.whatsapp.outbox.length;
    const hold = t.llm.hold("Escribe el guion");
    const { reset } = await raceReset(t, hold);
    expect(reset.status).toBe(200);
    expect(t.whatsapp.outbox.length).toBeGreaterThan(sentBefore);
    expect(snapshot(t.app)).toEqual(await freshSnapshot());
  });

  test("a tick held in the voice writes nothing into the new story", async () => {
    const t = await atBienvenida();
    const hold = t.voice.holdSynthesis();
    const { reset } = await raceReset(t, hold);
    expect(reset.status).toBe(200);
    expect(snapshot(t.app)).toEqual(await freshSnapshot());
  });

  test("a tick held sending the «Permitir» link writes nothing into the new story", async () => {
    const t = await atBienvenida();
    const hold = t.whatsapp.hold("text");
    const { reset, outboxAtReset } = await raceReset(t, hold);
    expect(reset.status).toBe(200);
    expect(t.whatsapp.outbox.map((m) => m.kind)).toEqual(["audio", "text"]);
    expect(t.whatsapp.outbox.length).toBe(outboxAtReset);
    expect(snapshot(t.app)).toEqual(await freshSnapshot());
  });

  test("ticks asked for while the reset waits run on the new story", async () => {
    const t = await atBienvenida();
    const hold = t.voice.holdSynthesis();
    const ticking = t.app.tick();
    await hold.reached;
    let outboxAtReset = -1;
    const resetting = Promise.resolve(post(t.app, "/sala/reset")).then((response) => {
      outboxAtReset = t.whatsapp.outbox.length;
      return response;
    });
    const tickRequest = post(t.app, "/sala/tick");
    const momentoRequest = post(t.app, LUN);
    hold.release();
    const [, reset, tickResponse, momentoResponse] = await Promise.all([
      ticking,
      resetting,
      tickRequest,
      momentoRequest,
    ]);
    expect(reset.status).toBe(200);
    expect(tickResponse.status).toBe(200);
    expect(momentoResponse.status).toBe(200);
    // The held bienvenida went out before the reset answered. The momento's
    // jump ran after the reset, so what followed is the new story's own bienvenida.
    const after = t.whatsapp.outbox.slice(outboxAtReset);
    expect(after.map((m) => m.kind)).toContain("audio");
    expect(after.map((m) => m.kind)).toEqual(t.app.store.mensajesSalientes().map((m) => m.kind));
    expect(t.app.store.citaOn("2026-10-19")).toMatchObject({ mensajeSalienteId: expect.any(Number) });
  });

  test("after a reset that waited on a tick the app still sends its citas", async () => {
    const t = await atBienvenida();
    const hold = t.voice.holdSynthesis();
    await raceReset(t, hold);
    const sentBefore = t.whatsapp.outbox.length;
    expect((await post(t.app, LUN)).status).toBe(200);
    expect(t.whatsapp.outbox.slice(sentBefore).map((m) => m.kind)).toContain("audio");
    expect(t.app.store.citaOn("2026-10-19")).toMatchObject({ mensajeSalienteId: expect.any(Number) });
  });

  test("two resets in a row with no tick running are each done before they return", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    await post(app, LUN);
    const fresh = await freshSnapshot();
    void app.reset();
    app.clock.set(new Date("2026-10-23T01:30:00Z"));
    void app.reset();
    expect(snapshot(app)).toEqual(fresh);
    expect(app.clock.now()).toEqual(PATRICIA_START);
  });

  test("a reset with no tick running is done before it returns", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    await app.reset();
    await post(app, LUN);
    await post(app, JUE);
    const fresh = await freshSnapshot();
    expect(snapshot(app)).not.toEqual(fresh);
    const resetting = app.reset();
    expect(snapshot(app)).toEqual(fresh);
    await resetting;
  });
});

type SalaState = {
  etapaHistorial: { at: string; from: unknown; to: unknown; motivo: string }[];
  decisiones: { at: string; tipo: string; motivo: string }[];
  cifraDelUltimoAudio: {
    at: string;
    cifra: unknown;
    estadoDeCuenta: unknown;
    fuente: unknown;
  } | null;
  proximaCita: { fecha: string; tipo: string; etapa: unknown; motivo: string } | null;
};

const salaState = async (app: App) => {
  const response = await get(app, "/sala/state", { "x-demo-token": TOKEN });
  expect(response.status).toBe(200);
  return (await response.json()) as SalaState;
};

/** Fictional figures the extractor would have read. */
const CIFRAS_EXTRAIDAS = {
  pagoMinimo: 18_500,
  totalFacturado: 320_000,
  cupo: null,
  tasaMensual: 0.031,
  fechaVencimiento: "2026-11-05",
  fechaCierre: "2026-10-15",
  mora: 0,
  pagosAnteriores: [],
  comprasEnCuotas: [],
};

describe("/sala state: etapa, decisiones, origen de la cifra, próxima cita", () => {
  const addEstado = (app: App) =>
    app.store.addEstadoDeCuenta({
      origen: "banco",
      ciclo: 8,
      fechaCierre: "2026-10-15",
      fechaVencimiento: "2026-11-05",
      cifras: null,
      pagoMinimo: 18_500,
    });
  const recordAudio = (app: App, estadoDeCuentaId: number | null | undefined, monto = 18_500) =>
    app.store.recordDecision({
      tipo: "mensaje",
      motivo: "salió la cita del lunes: nota de voz de 40 s",
      datos: {
        citaId: 1,
        decision: { cifra: { kind: "pago-minimo", monto } },
        guion: "Hola, soy Luna.",
        source: "llm",
        durationSeconds: 40,
        acortado: false,
        ...(estadoDeCuentaId === undefined ? {} : { estadoDeCuentaId }),
      },
    });

  test("answers the etapa history, the decisiones, the cifra's origin and the próxima cita", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.store.setEtapa(2, "abrió dos audios seguidos");
    app.store.setEtapa(3, "pagó más que el mínimo");
    const estado = addEstado(app);
    app.store.addSenal({
      tipo: "S1",
      origen: { mailId: "mail-banco-8", from: "Banco Ficticio <avisos@banco.example>", subject: "Tu estado de cuenta" },
    });
    app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "mail-banco-8", cifras: CIFRAS_EXTRAIDAS });
    recordAudio(app, null, 1);
    const audio = recordAudio(app, estado.id);
    app.store.recordDecision({ tipo: "mensaje", motivo: "no salió", datos: { citaId: 2, error: "falló" } });
    app.store.addCita({
      fecha: "2026-10-22",
      tipo: "jueves",
      estado: "programada",
      etapa: 3,
      motivo: "cita del jueves",
      pendienteIds: [],
    });

    const body = await salaState(app);
    expect(body.etapaHistorial.map(({ from, to, motivo }) => [from, to, motivo])).toEqual([
      [1, 2, "abrió dos audios seguidos"],
      [2, 3, "pagó más que el mínimo"],
    ]);
    expect(body.etapaHistorial[0]!.at).toBe(app.clock.now().toISOString());
    expect(body.decisiones.at(-1)?.motivo).toBe("no salió");
    expect(body.cifraDelUltimoAudio).toEqual({
      at: audio.at.toISOString(),
      cifra: { kind: "pago-minimo", monto: 18_500 },
      estadoDeCuenta: {
        origen: "banco",
        ciclo: 8,
        fechaVencimiento: "2026-11-05",
        pagoMinimo: 18_500,
        receivedAt: estado.receivedAt.toISOString(),
      },
      fuente: {
        kind: "correo",
        mailId: "mail-banco-8",
        subject: "Tu estado de cuenta",
        from: "Banco Ficticio <avisos@banco.example>",
      },
    });
    expect(body.proximaCita).toEqual({ fecha: "2026-10-22", tipo: "jueves", etapa: 3, motivo: "cita del jueves" });
  });

  test("decisiones are the latest 50, oldest first", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    for (let index = 0; index < 60; index++) {
      app.store.recordDecision({ tipo: "mensaje", motivo: `decisión ${index}`, datos: null });
    }
    const { decisiones } = await salaState(app);
    expect(decisiones).toHaveLength(50);
    expect([decisiones[0]?.motivo, decisiones.at(-1)?.motivo]).toEqual(["decisión 10", "decisión 59"]);
  });

  test("a foto's extracción is a foto fuente", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const estado = addEstado(app);
    app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "whatsapp:wamid.foto-1", cifras: CIFRAS_EXTRAIDAS });
    recordAudio(app, estado.id);
    const { cifraDelUltimoAudio } = await salaState(app);
    expect(cifraDelUltimoAudio?.fuente).toEqual({ kind: "foto", mailId: "whatsapp:wamid.foto-1" });
  });

  test("a mail with no señal leaves subject and from null", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const estado = addEstado(app);
    app.store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: "mail-sin-senal", cifras: CIFRAS_EXTRAIDAS });
    recordAudio(app, estado.id);
    const { cifraDelUltimoAudio } = await salaState(app);
    expect(cifraDelUltimoAudio?.fuente).toEqual({ kind: "correo", mailId: "mail-sin-senal", subject: null, from: null });
  });

  test("an older audio decision without estadoDeCuentaId has no estado de cuenta nor fuente", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    recordAudio(app, undefined);
    const { cifraDelUltimoAudio } = await salaState(app);
    expect(cifraDelUltimoAudio).toMatchObject({
      cifra: { kind: "pago-minimo", monto: 18_500 },
      estadoDeCuenta: null,
      fuente: null,
    });
  });

  test("an audio without a cifra is skipped, and none gives null", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.store.recordDecision({
      tipo: "mensaje",
      motivo: "salió la bienvenida",
      datos: { citaId: 1, decision: { cifra: null }, guion: "Hola", estadoDeCuentaId: null },
    });
    expect((await salaState(app)).cifraDelUltimoAudio).toBeNull();
  });

  test("a cita already sent, callada or dated before today is not the próxima cita", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const add = (fecha: string, estado: "programada" | "callada", motivo: string) =>
      app.store.addCita({ fecha, tipo: "jueves", estado, etapa: 1, motivo, pendienteIds: [] });
    add("2026-10-18", "programada", "ayer");
    add("2026-10-20", "callada", "callada");
    const enviada = add("2026-10-21", "programada", "enviada")!;
    const mensaje = app.store.addMensajeSaliente({ kind: "audio", text: "Hola", durationSeconds: 30, whatsappId: "w-1" });
    expect(app.store.markCitaSent(enviada.id, mensaje.id)).toBe(true);
    expect((await salaState(app)).proximaCita).toBeNull();
    add("2026-10-26", "programada", "la del lunes");
    add("2026-10-19", "programada", "la de hoy");
    expect((await salaState(app)).proximaCita?.motivo).toBe("la de hoy");
  });

  test("after a reset to Patricia's fixture the four keys are there", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    expect((await post(app, "/sala/reset")).status).toBe(200);
    const response = await get(app, "/sala/state", { "x-demo-token": TOKEN });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    for (const key of ["etapaHistorial", "decisiones", "cifraDelUltimoAudio", "proximaCita"]) {
      expect(Object.hasOwn(body, key)).toBe(true);
    }
  });
});
