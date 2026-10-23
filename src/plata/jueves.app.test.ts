import { describe, expect, test } from "bun:test";
import type { IncomingMail } from "../ports";
import { createTestApp } from "../testing";

const CATALOGO = "pedidos@catalogoaurora.example";
const JUEVES = new Date("2026-10-22T22:31:00-03:00");
const CIERRE = "Gracias por contarme, Patricia.";

let nextId = 1;
function mail(subject: string, receivedAt: Date): IncomingMail {
  return { id: `jueves-${nextId++}`, from: CATALOGO, subject, text: "", receivedAt, links: [] };
}

function setup(options: { s3?: boolean; pagoMinimo?: number | null } = {}) {
  const t = createTestApp({ llm: [["Anotado", "OK"]] });
  const { app, clock } = t;
  app.store.addEstadoDeCuenta({
    origen: "banco",
    ciclo: 1,
    fechaCierre: null,
    fechaVencimiento: null,
    cifras: null,
    pagoMinimo: options.pagoMinimo === undefined ? 41900 : options.pagoMinimo,
  });
  if (options.s3 ?? true) {
    app.receiveMail(mail("Pagamos tu pedido #1 por $30.000", clock.now()));
    clock.set(new Date("2026-10-20T13:00:00-03:00"));
    app.receiveMail(mail("Pagamos tu pedido #2 por $27.000", clock.now()));
    clock.set(new Date("2026-10-21T13:00:00-03:00"));
    app.receiveMail(mail("Pagamos tu pedido #3 por $24.000", clock.now()));
  }
  clock.set(JUEVES);
  return t;
}

async function jueves(t: ReturnType<typeof createTestApp>) {
  await t.app.tick();
  const cita = t.app.store.citaOn("2026-10-22");
  expect(cita).toMatchObject({ tipo: "jueves", estado: "programada" });
  // The cita's own audio is not under test here; only the replies to her emoji are.
  t.whatsapp.outbox.length = 0;
  return cita!;
}

const decisionsOf = (t: ReturnType<typeof createTestApp>, tipo: string) =>
  t.app.store.decisions().filter((d) => d.tipo === tipo);

describe("the jueves propuesta through the app", () => {
  test("the jueves cita carries the propuesta the motor computed", async () => {
    const t = setup();
    const cita = await jueves(t);

    const [propuesta, ...rest] = decisionsOf(t, "proponer-plata-apartada");
    expect(rest).toEqual([]);
    expect(propuesta!.datos).toMatchObject({ citaId: cita.id, apartado: 8100, pagoMinimo: 41900, monto: 50000 });
    const { texto } = propuesta!.datos as { texto: string };
    expect(texto).toContain("$8.100");
    expect(texto).toContain("$50.000");
    expect(propuesta!.motivo).toBe("propone pagar $50.000: mínimo $41.900 + $8.100 apartado");
  });

  test("👍 gets a warm reply naming the propuesta, and a second 👍 gets nothing", async () => {
    const t = setup();
    const cita = await jueves(t);

    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-1" });
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: `Anotado: $50.000 este mes. ${CIERRE}` }]);
    const [respuesta] = decisionsOf(t, "respuesta-propuesta");
    expect(respuesta!.datos).toMatchObject({ citaId: cita.id, eleccion: "propuesta", monto: 50000, source: "draft" });
    expect(respuesta!.motivo).toBe("eligió pagar $50.000");
    expect(t.app.store.mensajesSalientes().filter((m) => m.kind === "text")).toEqual([]);

    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-2" });
    expect(t.whatsapp.outbox).toHaveLength(1);
    expect(decisionsOf(t, "respuesta-propuesta")).toHaveLength(1);
  });

  test("👌 gets an equally warm reply with the same closing", async () => {
    const propuesta = setup();
    await jueves(propuesta);
    await propuesta.app.receiveMensaje({ text: "👍", whatsappId: "in-1" });

    const minimo = setup();
    await jueves(minimo);
    await minimo.app.receiveMensaje({ text: "👌🏽", whatsappId: "in-1" });

    expect(minimo.whatsapp.outbox).toHaveLength(1);
    const [reply] = minimo.whatsapp.outbox as Array<{ kind: "text"; text: string }>;
    expect(reply!.text).toContain("el mínimo");
    expect(reply!.text.endsWith(CIERRE)).toBe(true);
    const [other] = propuesta.whatsapp.outbox as Array<{ kind: "text"; text: string }>;
    expect(other!.text.endsWith(CIERRE)).toBe(true);
    expect(decisionsOf(minimo, "respuesta-propuesta")[0]!.datos).toMatchObject({ eleccion: "minimo" });
  });

  test("a week with no S3 has no propuesta and a 👍 sends nothing", async () => {
    const t = setup({ s3: false });
    await jueves(t);

    expect(decisionsOf(t, "proponer-plata-apartada")).toEqual([]);
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-1" });
    expect(t.whatsapp.outbox).toEqual([]);
    expect(decisionsOf(t, "respuesta-propuesta")).toEqual([]);
  });

  test("no banco estado de cuenta with a pago mínimo means no propuesta", async () => {
    const t = setup({ pagoMinimo: null });
    await jueves(t);

    expect(decisionsOf(t, "proponer-plata-apartada")).toEqual([]);
  });
  test("in the madrugada a 👍 gets no figure; the propuesta waits for her next answer", async () => {
    const t = setup();
    await jueves(t);

    t.clock.set(new Date("2026-10-23T01:00:00-03:00"));
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-1" });
    expect(t.whatsapp.outbox).toEqual([]);
    expect(decisionsOf(t, "respuesta-propuesta")).toEqual([]);

    t.clock.set(new Date("2026-10-23T08:00:00-03:00"));
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-2" });
    expect(t.whatsapp.outbox).toEqual([{ kind: "text", text: `Anotado: $50.000 este mes. ${CIERRE}` }]);
  });

  test("a 👍 the next week no longer answers last week's propuesta", async () => {
    const t = setup();
    await jueves(t);

    t.clock.set(new Date("2026-10-26T10:00:00-03:00"));
    await t.app.receiveMensaje({ text: "👍", whatsappId: "in-1" });
    expect(t.whatsapp.outbox).toEqual([]);
    expect(decisionsOf(t, "respuesta-propuesta")).toEqual([]);
  });
});
