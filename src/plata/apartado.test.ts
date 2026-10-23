import { describe, expect, test } from "bun:test";
import { parseSantiago } from "../clock/santiago";
import type { TipoSenal } from "../patricia/entities";
import { aporteDePedido, inicioDeSemana, montoDePedido, plataApartada, type SenalApartable } from "./apartado";

function senal(id: number, tipo: TipoSenal, monto: number | null, at: string): SenalApartable {
  return { id, tipo, monto, receivedAt: parseSantiago(at) };
}

describe("montoDePedido", () => {
  test.each([
    ["Te pagaron tu pedido del catálogo: $27.000", 27000],
    ["Pago recibido por $30.000", 30000],
    ["Monto: $ 27.000", 27000],
    ["Total $1.250.000 abonado", 1250000],
    ["Te transferimos $18500", 18500],
    ["Pedido #1234 pagado: $24.000 y envío $2.000", 24000],
    ["Pagamos tu pedido #1234", null],
    ["Sin montos aquí", null],
    ["Pagamos $9.999.999.999.999", null],
  ] as const)("%p reads as %p", (text, expected) => {
    expect(montoDePedido(text)).toBe(expected);
  });
});

describe("aporteDePedido", () => {
  test.each([
    [30000, 3000],
    [27000, 2700],
    [24000, 2400],
    [18500, 1900],
    [12900, 1300],
    [0, 0],
    [-5000, 0],
  ])("%p puts aside %p", (monto, aporte) => {
    expect(aporteDePedido(monto)).toBe(aporte);
  });
});

describe("inicioDeSemana", () => {
  test.each([
    ["a Wednesday", "2026-10-21T15:20", "2026-10-19T03:00:00.000Z"],
    ["a Sunday 23:30", "2026-10-25T23:30", "2026-10-19T03:00:00.000Z"],
    ["a Monday 00:00", "2026-10-26T00:00", "2026-10-26T03:00:00.000Z"],
  ])("for %s is Monday 00:00 in Santiago", (_, now, expected) => {
    expect(inicioDeSemana(parseSantiago(now)).toISOString()).toBe(expected);
  });
});

describe("plataApartada", () => {
  const now = parseSantiago("2026-10-23T21:00");
  const pedidos = [
    senal(1, "S3", 30000, "2026-10-19T10:00"),
    senal(2, "S3", 27000, "2026-10-20T12:00"),
    senal(3, "S3", 24000, "2026-10-22T18:00"),
  ];

  test("three pedidos in the same week put aside 8.100", () => {
    expect(plataApartada(pedidos, now)).toEqual({
      total: 8100,
      aportes: [
        { senalId: 1, monto: 30000, aporte: 3000 },
        { senalId: 2, monto: 27000, aporte: 2700 },
        { senalId: 3, monto: 24000, aporte: 2400 },
      ],
    });
  });

  test("a pago after them resets the tally", () => {
    expect(plataApartada([...pedidos, senal(4, "S5", null, "2026-10-23T09:00")], now)).toEqual({
      total: 0,
      aportes: [],
    });
  });

  test("only the pedidos after the last pago count", () => {
    const senales = [
      ...pedidos,
      senal(4, "S5", null, "2026-10-23T09:00"),
      senal(5, "S3", 18500, "2026-10-23T11:00"),
    ];
    expect(plataApartada(senales, now)).toEqual({
      total: 1900,
      aportes: [{ senalId: 5, monto: 18500, aporte: 1900 }],
    });
  });

  test("the clock, not the insert order, says whether a pedido came after the pago", () => {
    // A /demo clock reset can store a later señal at an earlier time.
    const senales = [senal(1, "S5", null, "2026-10-22T09:00"), senal(2, "S3", 30000, "2026-10-21T09:00")];
    expect(plataApartada(senales, now).total).toBe(0);
  });

  test("a pago from last week does not reset this week", () => {
    const senales = [senal(0, "S5", null, "2026-10-16T09:00"), ...pedidos];
    expect(plataApartada(senales, now).total).toBe(8100);
  });

  test("a pedido without a monto is left out", () => {
    const senales = [...pedidos, senal(4, "S3", null, "2026-10-23T10:00")];
    expect(plataApartada(senales, now).aportes.map((a) => a.senalId)).toEqual([1, 2, 3]);
  });

  test("other señales and señales after now do not count", () => {
    const senales = [
      senal(1, "S1", 50000, "2026-10-20T10:00"),
      senal(2, "S3", 30000, "2026-10-24T10:00"),
    ];
    expect(plataApartada(senales, now)).toEqual({ total: 0, aportes: [] });
  });

  test("a pedido from last week does not count", () => {
    const senales = [senal(1, "S3", 30000, "2026-10-18T22:00"), senal(2, "S3", 27000, "2026-10-20T12:00")];
    expect(plataApartada(senales, now).total).toBe(2700);
  });

  test("a Sunday-night pedido counts for its week and Monday 00:00 starts fresh", () => {
    const senales = [senal(1, "S3", 30000, "2026-10-25T23:50")];
    expect(plataApartada(senales, parseSantiago("2026-10-25T23:59")).total).toBe(3000);
    expect(plataApartada(senales, parseSantiago("2026-10-26T00:00")).total).toBe(0);
  });
});
