import { describe, expect, test } from "bun:test";
import type { TipoSenal } from "../patricia/entities";
import {
  aCompraEnCuotas,
  compraEnCuotas,
  comprasEnCuotas,
  esPlataDeCarino,
  type CompraRegistrada,
  type SenalEnCuotas,
} from "./cuotas";

function senal(id: number, tipo: TipoSenal, subject: string, at: string): SenalEnCuotas {
  return { id, tipo, origen: { subject }, receivedAt: new Date(at) };
}

describe("compraEnCuotas", () => {
  test.each([
    ["Confirmamos tu compra en 6 cuotas", { cuotas: 6, comercio: null }],
    [
      "Banco Andino: compra de $45.000 en 3 cuotas en Farmacia Ejemplo",
      { cuotas: 3, comercio: "Farmacia Ejemplo" },
    ],
    ["tu compra en seis cuotas", { cuotas: 6, comercio: null }],
    ["Tu compra en DOCE CUOTAS en Tienda Norte. Gracias", { cuotas: 12, comercio: "Tienda Norte" }],
    ["Compra en una cuota en Juguetería Ñandú (sucursal centro)", { cuotas: 1, comercio: "Juguetería Ñandú" }],
    ["Compra en 2 cuotas en , listo", { cuotas: 2, comercio: null }],
    ["Compra en 48 cuotas", { cuotas: 48, comercio: null }],
  ] as const)("%p reads as %p", (subject, expected) => {
    expect(compraEnCuotas(subject)).toEqual(expected);
  });

  test("digits and words give the same count", () => {
    expect(compraEnCuotas("compra en 6 cuotas")?.cuotas).toBe(compraEnCuotas("compra en seis cuotas")?.cuotas);
  });

  test.each([
    "Confirmamos tu compra en cuotas",
    "Recibimos tu pago",
    "Compra en 0 cuotas",
    "Compra en 49 cuotas",
  ])("%p reads as null", (subject) => {
    expect(compraEnCuotas(subject)).toBeNull();
  });
});

describe("esPlataDeCarino", () => {
  const december = new Date("2026-12-15T12:00:00-03:00");

  test.each([
    "Compra en 3 cuotas en Juguetería Central",
    "Tu regalo de Navidad en 2 cuotas",
    "Ropa para el nieto en 3 cuotas",
    "Compra de cumpleaños en 4 cuotas",
    "Pascua feliz: compra en 2 cuotas",
  ])("%p in December is plata de cariño", (subject) => {
    expect(esPlataDeCarino(subject, december)).toBe(true);
  });

  test("a gift in November is not", () => {
    expect(esPlataDeCarino("Tu regalo en 3 cuotas", new Date("2026-11-30T12:00:00-03:00"))).toBe(false);
  });

  test.each(["Ropa en 3 cuotas en Tienda Norte", "Compra en 2 cuotas en Farmacia Ejemplo", "Regaloneo en 2 cuotas"])(
    "%p in December is not",
    (subject) => {
      expect(esPlataDeCarino(subject, december)).toBe(false);
    },
  );

  test("December is read in Santiago", () => {
    // 2026-12-01 02:00 UTC is still 30 November in Santiago.
    expect(esPlataDeCarino("Tu regalo en 3 cuotas", new Date("2026-11-30T23:00:00-03:00"))).toBe(false);
    expect(esPlataDeCarino("Tu regalo en 3 cuotas", new Date("2026-12-01T00:30:00-03:00"))).toBe(true);
  });
});

describe("comprasEnCuotas", () => {
  const farmacia = senal(7, "S4", "Banco Andino: compra en 3 cuotas en Farmacia Ejemplo", "2026-10-22T10:00:00-03:00");

  test.each([
    ["2026-10-30T10:00:00-03:00", 3],
    ["2026-11-10T10:00:00-03:00", 2],
    ["2026-12-10T10:00:00-03:00", 1],
  ] as const)("on %p it has %p cuotas left, ending in enero", (now, restantes) => {
    expect(comprasEnCuotas([farmacia], new Date(now))).toEqual([
      {
        senalId: 7,
        cuotas: 3,
        comercio: "Farmacia Ejemplo",
        compradaEn: farmacia.receivedAt,
        cuotasRestantes: restantes,
        mesTermino: "enero",
        plataDeCarino: false,
      },
    ]);
  });

  test("a finished compra is dropped", () => {
    expect(comprasEnCuotas([farmacia], new Date("2027-01-10T10:00:00-03:00"))).toEqual([]);
  });

  test("only S4 señales that parse count, in input order", () => {
    const senales = [
      senal(1, "S3", "Pago de pedido en 3 cuotas", "2026-10-01T10:00:00-03:00"),
      senal(2, "S4", "Compra en 6 cuotas en Tienda Norte", "2026-10-05T10:00:00-03:00"),
      senal(3, "S4", "Tu compra fue aprobada", "2026-10-06T10:00:00-03:00"),
      farmacia,
    ];
    const compras = comprasEnCuotas(senales, new Date("2026-11-10T10:00:00-03:00"));
    expect(compras.map((c) => [c.senalId, c.cuotasRestantes, c.mesTermino])).toEqual([
      [2, 5, "abril"],
      [7, 2, "enero"],
    ]);
  });

  test("a December gift is marked plata de cariño", () => {
    const juguete = senal(9, "S4", "Compra en 2 cuotas en Juguetería Central", "2026-12-20T10:00:00-03:00");
    expect(comprasEnCuotas([juguete], new Date("2026-12-21T10:00:00-03:00"))[0]?.plataDeCarino).toBe(true);
  });
});

describe("aCompraEnCuotas", () => {
  const base: CompraRegistrada = {
    senalId: 7,
    cuotas: 3,
    comercio: "Farmacia Ejemplo",
    compradaEn: new Date("2026-10-22T10:00:00-03:00"),
    cuotasRestantes: 1,
    mesTermino: "enero",
    plataDeCarino: false,
  };

  test("names the comercio", () => {
    expect(aCompraEnCuotas(base)).toEqual({
      descripcion: "la compra en Farmacia Ejemplo",
      cuotasRestantes: 1,
      mesTermino: "enero",
    });
  });

  test("falls back without a comercio", () => {
    expect(aCompraEnCuotas({ ...base, comercio: null }).descripcion).toBe("la compra en cuotas");
  });
});
