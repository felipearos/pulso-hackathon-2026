import { describe, expect, test } from "bun:test";
import { allowedSenderDomains, allowedSender, type SenderKind } from "./senders";

describe("allowedSender", () => {
  test.each<[string, SenderKind]>([
    ["avisos@bancoandino.example", "banco"],
    ["Banco Andino <avisos@bancoandino.example>", "banco"],
    ["AVISOS@BancoAndino.EXAMPLE", "banco"],
    ["Tienda Plaza <cuenta@tiendaplaza.example>", "tienda"],
    ["pedidos@catalogoaurora.example", "catalogo"],
    ["  Catálogo Aurora <hola@catalogoaurora.example>  ", "catalogo"],
    ['"Andino, Banco" <avisos@bancoandino.example>', "banco"],
    ['"Fraude <evil@fraude.example>" <avisos@bancoandino.example>', "banco"],
  ])("allows %p as %p", (from, kind) => {
    expect(allowedSender(from)?.kind).toBe(kind);
  });

  test.each([
    "avisos@bancoandino.example.com",
    "avisos@banco-andino.example",
    "avisos@x.bancoandino.example",
    "avisos@bancoandin0.example",
    "Banco Andino <avisos@bancoandino.example.com>",
    "bancoandino.example <avisos@otro.example>",
    '"Banco <avisos@bancoandino.example>" <evil@fraude.example>',
    "Banco <avisos@bancoandino.example> <evil@fraude.example>",
    "avisos@bancoandino.example, evil@fraude.example",
    "evil@fraude.example <",
    "evil@fraude.example@bancoandino.example",
    '"sin cerrar <avisos@bancoandino.example>',
    "amiga@correo.example",
    "sin arroba",
    "",
  ])("rejects %p", (from) => {
    expect(allowedSender(from)).toBeNull();
  });
});

test("allowedSenderDomains lists the three allowed domains", () => {
  expect(allowedSenderDomains()).toEqual([
    "bancoandino.example",
    "tiendaplaza.example",
    "catalogoaurora.example",
  ]);
});
