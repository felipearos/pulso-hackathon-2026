import { describe, expect, test } from "bun:test";
import { allowedSenderDomains, allowedSender, demoSenders, type SenderKind } from "./senders";

describe("allowedSender", () => {
  test.each<[string, SenderKind]>([
    ["avisos@bancoficticio.example", "banco"],
    ["Banco Ficticio <avisos@bancoficticio.example>", "banco"],
    ["AVISOS@BancoFicticio.EXAMPLE", "banco"],
    ["Tienda Plaza <cuenta@tiendaplaza.example>", "tienda"],
    ["pedidos@catalogoejemplo.example", "catalogo"],
    ["  Catálogo Ejemplo <hola@catalogoejemplo.example>  ", "catalogo"],
    ['"Ficticio, Banco" <avisos@bancoficticio.example>', "banco"],
    ['"Fraude <evil@fraude.example>" <avisos@bancoficticio.example>', "banco"],
  ])("allows %p as %p", (from, kind) => {
    expect(allowedSender(from)?.kind).toBe(kind);
  });

  test.each([
    "avisos@bancoficticio.example.com",
    "avisos@banco-ficticio.example",
    "avisos@x.bancoficticio.example",
    "avisos@bancofictici0.example",
    "Banco Ficticio <avisos@bancoficticio.example.com>",
    "bancoficticio.example <avisos@otro.example>",
    '"Banco <avisos@bancoficticio.example>" <evil@fraude.example>',
    "Banco <avisos@bancoficticio.example> <evil@fraude.example>",
    "avisos@bancoficticio.example, evil@fraude.example",
    "evil@fraude.example <",
    "evil@fraude.example@bancoficticio.example",
    '"sin cerrar <avisos@bancoficticio.example>',
    "amiga@correo.example",
    "sin arroba",
    "",
  ])("rejects %p", (from) => {
    expect(allowedSender(from)).toBeNull();
  });
});

test("allowedSenderDomains lists the three allowed domains", () => {
  expect(allowedSenderDomains()).toEqual([
    "bancoficticio.example",
    "tiendaplaza.example",
    "catalogoejemplo.example",
  ]);
});

describe("demo senders", () => {
  test("allow a whole address from DEMO_SENDERS as its kind, never its whole domain", () => {
    const env = { DEMO_SENDERS: "Ana@Example.com=banco, juan@example.com=tienda, malo@example.com=otro" };
    expect(demoSenders(env)).toEqual([
      { domain: "example.com", kind: "banco", address: "ana@example.com" },
      { domain: "example.com", kind: "tienda", address: "juan@example.com" },
    ]);
  });
});
