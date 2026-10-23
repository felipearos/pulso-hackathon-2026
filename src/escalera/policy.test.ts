import { describe, expect, test } from "bun:test";
import { decideEtapa, etapaOnReturn } from "./policy";
import type { Angustia, Etapa, EtapaInput, EtapaMove, Intencion, Senal } from "./policy";

function senal(intencion: Intencion, citaEtapa: Etapa | null = null): Senal {
  return { intencion, citaEtapa };
}

const accepted = (etapa: Etapa): Senal => senal({ kind: "accepted" }, etapa);
const minimum = (etapa: Etapa): Senal => senal({ kind: "minimum" }, etapa);
const angustia = (value: Angustia): Senal => senal({ kind: "angustia", value });

function input(overrides: Partial<EtapaInput>): EtapaInput {
  return {
    etapa: 2,
    senales: [],
    lastAngustia: null,
    estadoDeCuentaTienda: true,
    estadoDeCuentaBancoNuevo: true,
    ...overrides,
  };
}

type Row = [string, Partial<EtapaInput>, EtapaMove["kind"], Etapa];

describe("decideEtapa", () => {
  const rows: Row[] = [
    // Rule 1: crisis freezes.
    ["crisis freezes", { etapa: 3, senales: [senal({ kind: "crisis" })] }, "freeze", 3],
    [
      "crisis wins over everything",
      { etapa: 3, senales: [accepted(3), angustia(5), senal({ kind: "crisis" })] },
      "freeze",
      3,
    ],
    // Rule 2: down.
    ["angustia 4 signal goes down", { etapa: 3, senales: [angustia(4)] }, "down", 2],
    ["doesNotWantToSee goes down", { etapa: 3, senales: [senal({ kind: "doesNotWantToSee" })] }, "down", 2],
    ["down wins over up", { etapa: 3, senales: [accepted(3), angustia(4)] }, "down", 2],
    ["down from graduada goes to 5", { etapa: "graduada", senales: [angustia(5)] }, "down", 5],
    ["down at etapa 1 stays", { etapa: 1, senales: [angustia(4)] }, "stay", 1],
    // Rule 3: up.
    ["accepted cita of current etapa goes up", { etapa: 2, senales: [accepted(2)] }, "up", 3],
    ["minimum counts as answering the cita", { etapa: 1, senales: [minimum(1)] }, "up", 2],
    ["angustia 3 signal still allows up", { etapa: 2, senales: [accepted(2), angustia(3)] }, "up", 3],
    ["lastAngustia 3 allows up", { etapa: 2, senales: [accepted(2)], lastAngustia: 3 }, "up", 3],
    ["lastAngustia 4 blocks up", { etapa: 2, senales: [accepted(2)], lastAngustia: 4 }, "stay", 2],
    [
      "newer angustia signal overrides lastAngustia",
      { etapa: 2, senales: [accepted(2), angustia(2)], lastAngustia: 4 },
      "up",
      3,
    ],
    ["into 4 with tienda", { etapa: 3, senales: [accepted(3)] }, "up", 4],
    ["into 4 without tienda", { etapa: 3, senales: [accepted(3)], estadoDeCuentaTienda: false }, "stay", 3],
    ["into 5 with banco nuevo", { etapa: 4, senales: [accepted(4)] }, "up", 5],
    ["into 5 without banco nuevo", { etapa: 4, senales: [accepted(4)], estadoDeCuentaBancoNuevo: false }, "stay", 4],
    ["from 5 graduates", { etapa: 5, senales: [accepted(5)] }, "graduate", "graduada"],
    ["graduada answering a cita stays", { etapa: "graduada", senales: [accepted("graduada")] }, "stay", "graduada"],
    // Rule 4: stay.
    ["answers to two citas in one batch move one etapa", { etapa: 2, senales: [accepted(2), accepted(3)] }, "up", 3],
    ["no signals", { etapa: 2, senales: [] }, "stay", 2],
    ["👌 / listened", { etapa: 2, senales: [senal({ kind: "listened" }, 2)] }, "stay", 2],
    ["cita of another etapa", { etapa: 2, senales: [accepted(1)] }, "stay", 2],
    ["accepted out of the blue", { etapa: 2, senales: [senal({ kind: "accepted" })] }, "stay", 2],
    ["pause", { etapa: 2, senales: [senal({ kind: "pause" })] }, "stay", 2],
    ["hello", { etapa: 2, senales: [senal({ kind: "hello" })] }, "stay", 2],
    ["askWhy", { etapa: 2, senales: [senal({ kind: "askWhy" })] }, "stay", 2],
    ["askWhatRead", { etapa: 2, senales: [senal({ kind: "askWhatRead" })] }, "stay", 2],
    ["other", { etapa: 2, senales: [senal({ kind: "other" })] }, "stay", 2],
    ["angustia 3 alone", { etapa: 2, senales: [angustia(3)] }, "stay", 2],
  ];

  test.each(rows)("%s", (_name, overrides, kind, to) => {
    const move = decideEtapa(input(overrides));
    expect(move.kind).toBe(kind);
    expect(move.from).toBe(overrides.etapa ?? 2);
    expect(move.to).toBe(to);
    expect(move.reason.length).toBeGreaterThan(0);
  });

  test.each([
    ["crisis", { etapa: 3, senales: [senal({ kind: "crisis" })] }, "congelada: crisis"],
    ["angustia 4", { etapa: 3, senales: [angustia(4)] }, "bajó: angustia 4"],
    [
      "doesNotWantToSee",
      { etapa: 3, senales: [senal({ kind: "doesNotWantToSee" })] },
      "bajó: dijo que no quiere ver eso",
    ],
    [
      "installmentPurchase",
      { etapa: 2, senales: [senal({ kind: "installmentPurchase" })] },
      "se queda: contó una compra en cuotas",
    ],
    [
      "up with angustia",
      { etapa: 2, senales: [accepted(2), angustia(2)] },
      "subió: respondió la cita de la etapa 2, angustia 2",
    ],
    ["up without angustia", { etapa: 2, senales: [accepted(2)] }, "subió: respondió la cita de la etapa 2, sin angustia"],
    [
      "graduation",
      { etapa: 5, senales: [accepted(5)] },
      "se graduó: respondió la cita de la etapa 5, sin angustia",
    ],
    [
      "missing tienda",
      { etapa: 3, senales: [accepted(3)], estadoDeCuentaTienda: false },
      "se queda: falta un estado de cuenta de la tienda",
    ],
    [
      "missing banco nuevo",
      { etapa: 4, senales: [accepted(4)], estadoDeCuentaBancoNuevo: false },
      "se queda: falta un estado de cuenta nuevo del banco",
    ],
    ["listened", { etapa: 2, senales: [senal({ kind: "listened" }, 2)] }, "se queda: solo escuchó"],
    ["no signals", { etapa: 2, senales: [] }, "se queda: sin señal"],
  ] as [string, Partial<EtapaInput>, string][])("reason: %s", (_name, overrides, reason) => {
    expect(decideEtapa(input(overrides)).reason).toBe(reason);
  });

  test.each([1, 2, 3, 4, 5] as Etapa[])("never moves twice with the same senales from etapa %p", (etapa) => {
    const senales = [accepted(etapa), angustia(1)];
    const first = decideEtapa(input({ etapa, senales }));
    expect(first.to).not.toBe(etapa);
    const second = decideEtapa(input({ etapa: first.to, senales }));
    expect(second.kind).toBe("stay");
    expect(second.to).toBe(first.to);
  });
});

describe("etapaOnReturn", () => {
  test.each([
    [4, 0, false, 4],
    [4, 1, false, 3],
    [4, 3, false, 1],
    [2, 3, false, 1],
    ["graduada", 0, false, "graduada"],
    ["graduada", 1, false, 5],
    ["graduada", 3, false, 3],
    [5, 0, true, 1],
    [5, 1, true, 1],
    [4, 3, true, 1],
    ["graduada", 0, true, 1],
  ] as [Etapa, number, boolean, Etapa][])("from %p missing %p cycles, afterCrisis %p → %p", (etapa, missedCycles, afterCrisis, expected) => {
    const result = etapaOnReturn({ etapa, missedCycles, afterCrisis });
    expect(result.etapa).toBe(expected);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test.each([
    [3, 1, false, "vuelve en la etapa 2: perdió 1 ciclo de estado de cuenta"],
    [4, 3, false, "vuelve en la etapa 1: perdió 3 ciclos de estado de cuenta"],
    [4, 0, true, "vuelve en la etapa 1: después de una crisis"],
  ] as [Etapa, number, boolean, string][])("reason from %p missing %p cycles, afterCrisis %p", (etapa, missedCycles, afterCrisis, reason) => {
    expect(etapaOnReturn({ etapa, missedCycles, afterCrisis }).reason).toBe(reason);
  });
});
