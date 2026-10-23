import { describe, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "../testing";
import { propuestaVerloManana, respuestaCuidado } from "./verlo-manana";

// The texts the fixture Patricia, nombre «Patricia», gets.
const PROPUESTA_VERLO_MANANA = propuestaVerloManana("Patricia");
const RESPUESTA_CUIDADO = respuestaCuidado("Patricia");

const START = new Date("2026-10-21T20:00:00-03:00");
const LLM_REPLIES: Array<[string, string]> = [
  ["Voy a comprar unas zapatillas en cuotas", '{"intencion":"installmentPurchase"}'],
  ["También voy a comprar una chaqueta en cuotas", '{"intencion":"installmentPurchase"}'],
  ["Ahora compraré una cocina en cuotas", '{"intencion":"installmentPurchase"}'],
  ["Estoy pensando comprar un refrigerador en cuotas", '{"intencion":"installmentPurchase"}'],
  ["Le compré el remedio a mi mamá en cuotas", '{"intencion":"installmentPurchase"}'],
  ["Mañana compro en cuotas lo de MI MAMÁ", '{"intencion":"installmentPurchase"}'],
  ["Saqué en cuotas los remedios del mes", '{"intencion":"installmentPurchase"}'],
  ["Hoy quiero conversar con mi hija", '{"intencion":"other"}'],
  [PROPUESTA_VERLO_MANANA, "OK"],
  [RESPUESTA_CUIDADO, "OK"],
];

function setup(): TestApp {
  return createTestApp({ now: START, llm: LLM_REPLIES });
}

function outboxTexts(t: TestApp): string[] {
  return t.whatsapp.outbox.filter((message) => message.kind === "text").map((message) => message.text);
}

function decisionsOf(t: TestApp, tipo: string) {
  return t.app.store.decisions().filter((decision) => decision.tipo === tipo);
}

describe("answerCompraEnCuotas through the app", () => {
  test("proposes seeing a new cuotas purchase tomorrow", async () => {
    const t = setup();

    await t.app.receiveMensaje({ text: "Voy a comprar unas zapatillas en cuotas", whatsappId: "in-1" });

    expect(outboxTexts(t)).toEqual([PROPUESTA_VERLO_MANANA]);
    expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(1);
  });

  test("keeps one proposal open the same evening and the next morning", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: "Voy a comprar unas zapatillas en cuotas", whatsappId: "in-1" });

    t.clock.set(new Date("2026-10-21T22:00:00-03:00"));
    await t.app.receiveMensaje({ text: "También voy a comprar una chaqueta en cuotas", whatsappId: "in-2" });
    t.clock.set(new Date("2026-10-22T09:00:00-03:00"));
    await t.app.receiveMensaje({ text: "Ahora compraré una cocina en cuotas", whatsappId: "in-3" });

    expect(outboxTexts(t)).toEqual([PROPUESTA_VERLO_MANANA]);
    expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(1);
  });

  test("proposes again after the next Santiago day has ended", async () => {
    const t = setup();
    await t.app.receiveMensaje({ text: "Voy a comprar unas zapatillas en cuotas", whatsappId: "in-1" });
    t.clock.set(new Date("2026-10-23T20:00:00-03:00"));

    await t.app.receiveMensaje({ text: "Estoy pensando comprar un refrigerador en cuotas", whatsappId: "in-2" });

    expect(outboxTexts(t)).toEqual([PROPUESTA_VERLO_MANANA, PROPUESTA_VERLO_MANANA]);
    expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(2);
  });

  test("answers warmly about a remedy for her mother without proposing", async () => {
    const t = setup();

    await t.app.receiveMensaje({ text: "Le compré el remedio a mi mamá en cuotas", whatsappId: "in-1" });

    expect(outboxTexts(t)).toEqual([RESPUESTA_CUIDADO]);
    expect(decisionsOf(t, "acompanar-compra")).toHaveLength(1);
    expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(0);
  });

  test.each(["Mañana compro en cuotas lo de MI MAMÁ", "Saqué en cuotas los remedios del mes"])(
    "answers warmly without proposing when %p mentions only one of the two",
    async (text) => {
      const t = setup();

      await t.app.receiveMensaje({ text, whatsappId: "in-1" });

      expect(outboxTexts(t)).toEqual([RESPUESTA_CUIDADO]);
      expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(0);
    },
  );

  test("does not propose during the madrugada", async () => {
    const t = setup();
    t.clock.set(new Date("2026-10-22T02:00:00-03:00"));

    await t.app.receiveMensaje({ text: "Voy a comprar unas zapatillas en cuotas", whatsappId: "in-1" });

    expect(outboxTexts(t)).toEqual([]);
    expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(0);
  });

  test("leaves a message outside cuotas to the other reply paths", async () => {
    const t = setup();

    await t.app.receiveMensaje({ text: "Hoy quiero conversar con mi hija", whatsappId: "in-1" });

    expect(outboxTexts(t)).toEqual([]);
    expect(decisionsOf(t, "proponer-verlo-manana")).toHaveLength(0);
    expect(decisionsOf(t, "acompanar-compra")).toHaveLength(0);
  });
});
