import { describe, expect, test } from "bun:test";
import { dominiosPermitidos, remitentePermitido } from "./remitentes";

describe("remitentePermitido", () => {
  test.each([
    ["avisos@bancoandino.example", "banco"],
    ["Banco Andino <avisos@bancoandino.example>", "banco"],
    ["AVISOS@BancoAndino.EXAMPLE", "banco"],
    ["Tienda Plaza <cuenta@tiendaplaza.example>", "tienda"],
    ["pedidos@catalogoaurora.example", "catalogo"],
    ["  Catálogo Aurora <hola@catalogoaurora.example>  ", "catalogo"],
  ])("allows %p as %p", (from, tipo) => {
    expect(remitentePermitido(from)?.tipo).toBe(tipo as "banco" | "tienda" | "catalogo");
  });

  test.each([
    "avisos@bancoandino.example.com",
    "avisos@banco-andino.example",
    "avisos@x.bancoandino.example",
    "avisos@bancoandin0.example",
    "Banco Andino <avisos@bancoandino.example.com>",
    "bancoandino.example <avisos@otro.example>",
    "amiga@correo.example",
    "sin arroba",
    "",
  ])("rejects %p", (from) => {
    expect(remitentePermitido(from)).toBeNull();
  });
});

test("dominiosPermitidos lists the three allowed domains", () => {
  expect(dominiosPermitidos()).toEqual([
    "bancoandino.example",
    "tiendaplaza.example",
    "catalogoaurora.example",
  ]);
});
