import { describe, expect, test } from "bun:test";
import { santiagoParts } from "../clock/santiago";
import { PATRICIA_START } from "../patricia/fixtures";
import type { App } from "../app";
import { createTestApp } from "../testing";

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
    estados: strip(app.store.estadosDeCuenta()),
    senales: strip(app.store.senales()),
    decisiones: strip(app.store.decisions()),
    citas: app.store.citas(),
    pendientes: app.store.pendientes(),
    salientes: app.store.mensajesSalientes(),
    entrantes: app.store.mensajesEntrantes(),
  };
};

describe("/demo without the operator token", () => {
  const paths: [string, string][] = [
    ["GET", "/demo"],
    ["GET", "/demo/state"],
    ["POST", "/demo/tick"],
    ["POST", "/demo/reset"],
    ["POST", "/demo/moments/jue-2230"],
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
      for (const headers of [{}, { "x-demo-token": "otro" }, { "x-demo-token": `${TOKEN}x` }]) {
        const response = await app.handle(new Request(`http://localhost${path}`, { method, headers }));
        expect([method, path, response.status]).toEqual([method, path, 404]);
      }
    }
  });

  test("a wrong token changes nothing", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    const before = snapshot(app);
    await post(app, "/demo/moments/jue-2230", { "x-demo-token": "otro" });
    await post(app, "/demo/reset", {});
    expect(snapshot(app)).toEqual(before);
  });
});

describe("/demo with the operator token", () => {
  test("serves the control room page with the token in the query", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const response = await get(app, `/demo?token=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Sala de control");
  });

  test("the control room page calls every /demo endpoint with the token header", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const page = await (await get(app, `/demo?token=${TOKEN}`)).text();
    for (const reference of ["/demo/state", "/demo/moments/", "/demo/reset", "/demo/tick", "x-demo-token"]) {
      expect(page).toContain(reference);
    }
  });

  test("state lists the momentos of the guion from configuration", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const response = await get(app, "/demo/state", { "x-demo-token": TOKEN });
    const body = (await response.json()) as { guion: { id: string; label: string }[] };
    expect(response.status).toBe(200);
    expect(body.guion.map((momento) => momento.id)).toContain("jue-2230");
  });

  test("«Jue 22:30» moves the clock to Thursday 22:30 and its tick sets the jueves cita", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    const response = await post(app, "/demo/moments/jue-2230");
    expect(response.status).toBe(200);
    const parts = santiagoParts(app.clock.now());
    expect([parts.weekday, parts.hour, parts.minute]).toEqual([4, 22, 30]);
    expect(app.store.citaOn("2026-10-22")).not.toBeNull();
  });

  test("an unknown momento is refused and leaves the clock alone", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    app.reset();
    const response = await post(app, "/demo/moments/viernes");
    expect(response.status).toBe(400);
    expect(app.clock.now().toISOString()).toBe(PATRICIA_START.toISOString());
  });

  test("reset leaves the base as the fixture load does", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    const { app: fresh } = createTestApp();
    fresh.reset();
    app.reset();
    await post(app, "/demo/moments/lun-2230");
    await post(app, "/demo/moments/jue-2230");
    expect(snapshot(app)).not.toEqual(snapshot(fresh));
    const response = await post(app, "/demo/reset");
    expect(response.status).toBe(200);
    expect(snapshot(app)).toEqual(snapshot(fresh));
  });

  test("other paths still reach the app's own routes", async () => {
    const { app } = createTestApp({ demoToken: TOKEN });
    expect((await get(app, "/health")).status).toBe(200);
    expect((await get(app, "/demonio", { "x-demo-token": TOKEN })).status).toBe(404);
  });
});
