import { describe, expect, test } from "bun:test";
import { TIENDA_PLAZA_MINIMUM_RULE } from "../mail/estado-de-cuenta";
import type { EstadoDeCuentaInput } from "../patricia/store";
import { createTestApp } from "../testing";
import type { CifrasExtraidas } from "./extractor";
import {
  answerMinimoContado,
  guardarFotoComoEstadoDeCuenta,
  textoMinimoCoincide,
  textoMinimoDistinto,
} from "./minimo-contado";

/** The tone review passes every text Luna answers a mínimo with. */
const TONE_OK: [RegExp, string] = [/abriste tú/, "OK"];

function estado(input: Partial<EstadoDeCuentaInput> & Pick<EstadoDeCuentaInput, "origen" | "ciclo">): EstadoDeCuentaInput {
  return { fechaCierre: null, fechaVencimiento: null, cifras: null, pagoMinimo: null, ...input };
}

function setup() {
  const t = createTestApp({ llm: [TONE_OK] });
  const { store } = t.app;
  return { ...t, store, deps: { store, llm: t.llm, whatsapp: t.whatsapp, db: t.db } };
}

function lastMensaje(store: ReturnType<typeof setup>["store"]) {
  return store.decisions().filter((d) => d.tipo === "mensaje").at(-1);
}

describe("answerMinimoContado", () => {
  test("a mínimo that matches the estado de cuenta is celebrated with that figure", async () => {
    const { store, whatsapp, deps } = setup();
    const guardado = store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));

    await answerMinimoContado(deps, { origen: "banco", contado: 40100, fuente: "texto" });

    const text = textoMinimoCoincide("banco", 40100, "Patricia");
    expect(text).toContain("$40.100");
    expect(whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(lastMensaje(store)).toMatchObject({
      motivo: "celebró el mínimo que contó: coincide con el estado de cuenta",
      datos: {
        origen: "banco",
        contado: 40100,
        guardado: 40100,
        fuente: "texto",
        estadoDeCuentaId: guardado.id,
        text,
        source: "draft",
        whatsappId: "wamid-1",
      },
    });
  });

  test("a mínimo that does not match is answered gently with only the stored figure", async () => {
    const { store, whatsapp, deps } = setup();
    store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));

    await answerMinimoContado(deps, { origen: "banco", contado: 41000, fuente: "texto" });

    const text = textoMinimoDistinto("banco", 40100);
    expect(whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(text).toContain("$40.100");
    expect(text).not.toContain("41");
    expect(lastMensaje(store)).toMatchObject({
      motivo: "corrigió con suavidad el mínimo que contó: no coincide con el estado de cuenta",
      datos: { contado: 41000, guardado: 40100, source: "draft" },
    });
  });

  test("the tienda's mínimo is compared with the tienda's latest estado de cuenta, not the bank's", async () => {
    const { store, whatsapp, deps } = setup();
    store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 3, pagoMinimo: 40100 }));
    store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 1, pagoMinimo: 17000 }));
    const latest = store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 2, pagoMinimo: 18500 }));
    store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 3 }));

    await answerMinimoContado(deps, { origen: "tienda", contado: 18500, fuente: "foto" });

    expect(whatsapp.outbox).toEqual([{ kind: "text", text: textoMinimoCoincide("tienda", 18500, "Patricia") }]);
    expect(lastMensaje(store)?.datos).toMatchObject({ origen: "tienda", guardado: 18500, estadoDeCuentaId: latest.id });
  });

  test("nothing is sent during a pausa", async () => {
    const { store, whatsapp, llm, deps } = setup();
    store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));
    store.updatePatricia({ enPausa: true });

    await answerMinimoContado(deps, { origen: "banco", contado: 40100, fuente: "texto" });

    expect(whatsapp.outbox).toEqual([]);
    expect(llm.calls).toEqual([]);
    expect(store.decisions().filter((d) => d.tipo === "mensaje")).toEqual([]);
  });

  test("a send failure is swallowed and records no answer", async () => {
    const { store, whatsapp, deps } = setup();
    store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 1, pagoMinimo: 40100 }));
    whatsapp.failNextTexts = 1;

    await answerMinimoContado(deps, { origen: "banco", contado: 40100, fuente: "texto" });

    expect(whatsapp.outbox).toEqual([]);
    expect(store.decisions().filter((d) => d.tipo === "mensaje")).toEqual([]);
  });
});

describe("guardarFotoComoEstadoDeCuenta", () => {
  const cifras: CifrasExtraidas = {
    pagoMinimo: 18500,
    totalFacturado: 370000,
    cupo: null,
    tasaMensual: 0.035,
    fechaVencimiento: "2026-11-10",
    fechaCierre: null,
    mora: null,
    pagosAnteriores: null,
    comprasEnCuotas: null,
  };

  test("a foto with none stored becomes the tienda's next estado de cuenta and its mínimo is celebrated", async () => {
    const { store, whatsapp, deps } = setup();
    store.addEstadoDeCuenta(estado({ origen: "banco", ciclo: 4, pagoMinimo: 40100 }));
    store.addEstadoDeCuenta(estado({ origen: "tienda", ciclo: 1 }));

    const guardado = guardarFotoComoEstadoDeCuenta(deps, { origen: "tienda", cifras, whatsappId: "wamid.foto" });

    expect(guardado).toMatchObject({
      origen: "tienda",
      ciclo: 2,
      pagoMinimo: 18500,
      fechaVencimiento: "2026-11-10",
      fechaCierre: null,
      cifras: { totalBilled: 370000, monthlyRate: 0.035, minimumRule: TIENDA_PLAZA_MINIMUM_RULE },
    });
    expect(store.extraccionForMail("whatsapp:wamid.foto")).toMatchObject({ estadoDeCuentaId: guardado.id, cifras });
    const callados = store.decisions().filter((d) => d.tipo === "callar-cifra").map((d) => (d.datos as { campo: string }).campo);
    expect(callados.sort()).toEqual(["comprasEnCuotas", "cupo", "fechaCierre", "mora", "pagosAnteriores"]);
    expect(lastMensaje(store)).toMatchObject({
      motivo: "Guardé el estado de cuenta de la tienda que me mandó en foto (ciclo 2).",
      datos: { estadoDeCuentaId: guardado.id },
    });

    await answerMinimoContado(deps, { origen: "tienda", contado: 18500, fuente: "foto", guardadaRecien: true });

    // Nothing to compare it with: celebrated, never «lo leímos igual».
    const text = textoMinimoCoincide("tienda", 18500, "Patricia", false);
    expect(text).not.toContain("igual");
    expect(whatsapp.outbox).toEqual([{ kind: "text", text }]);
    expect(lastMensaje(store)?.datos).toMatchObject({ guardado: null, contado: 18500 });
  });

  test("a foto with no Meta id is still kept under a unique whatsapp key", () => {
    const { store, deps } = setup();

    const first = guardarFotoComoEstadoDeCuenta(deps, { origen: "banco", cifras, whatsappId: null });
    const second = guardarFotoComoEstadoDeCuenta(deps, { origen: "banco", cifras, whatsappId: null });

    expect(store.extraccionForMail("whatsapp:foto-banco-1")?.estadoDeCuentaId).toBe(first.id);
    expect(store.extraccionForMail("whatsapp:foto-banco-2")?.estadoDeCuentaId).toBe(second.id);
  });
});
