import { describe, expect, test } from "bun:test";
import type { TipoSenal } from "../patricia/entities";
import { classifyByRules } from "./rules";

const BANCO = "Banco Andino <avisos@bancoandino.example>";
const TIENDA = "Tienda Plaza <cuenta@tiendaplaza.example>";
const CATALOGO = "Catálogo Aurora <hola@catalogoaurora.example>";

const cases: [string, string, TipoSenal, string][] = [
  [BANCO, "Recibimos tu pago", "S5", "Remitente del banco y el asunto dice «recibimos tu pago»."],
  [TIENDA, "¡RECIBIMOS TU PAGO!", "S5", "Remitente de la tienda y el asunto dice «recibimos tu pago»."],
  [BANCO, "Tu estado de cuenta de octubre está disponible", "S1", "Remitente del banco y el asunto dice «estado de cuenta»."],
  [BANCO, "ESTADO DE CUENTA Tarjeta Andino", "S1", "Remitente del banco y el asunto dice «estado de cuenta»."],
  [TIENDA, "Tu Estado de Cuenta Tienda Plaza ya está listo", "S2", "Remitente de la tienda y el asunto dice «estado de cuenta»."],
  [CATALOGO, "Pagamos tu pedido N° 4521", "S3", "Remitente del catálogo y el asunto dice «pagamos tu pedido»."],
  [CATALOGO, "Confirmación de pago de tu pedido", "S3", "Remitente del catálogo y el asunto dice «pago de tu pedido»."],
  [BANCO, "Compraste en 6 cuotas en Farmacia Sol", "S4", "Remitente del banco y el asunto dice «cuotas»."],
  [TIENDA, "Tu compra en 3 CUOTAS sin interés", "S4", "Remitente de la tienda y el asunto dice «cuotas»."],
  [BANCO, "Tu tarjeta vence el 5 de noviembre", "S6", "Remitente del banco y el asunto dice «vence»."],
  [TIENDA, "Aviso de vencimiento: paga antes del 10", "S6", "Remitente de la tienda y el asunto dice «vencimiento»."],
  [BANCO, "Recordatorio: fecha de VENCIMÍENTO próxima", "S6", "Remitente del banco y el asunto dice «vencimiento»."],
  [CATALOGO, "¡Llegó el nuevo catálogo de primavera!", "ignorado", "Remitente del catálogo y el asunto no habla de un pedido pagado."],
  [CATALOGO, "Ofertas exclusivas solo por hoy", "ignorado", "Remitente del catálogo y el asunto no habla de un pedido pagado."],
];

describe("classifyByRules", () => {
  test.each(cases)("from %p with subject %p is %p", (from, subject, tipo, motivo) => {
    expect(classifyByRules({ from, subject })).toEqual({ tipo, motivo });
  });

  test("a payment receipt wins over a statement in the same subject", () => {
    expect(classifyByRules({ from: BANCO, subject: "Recibimos tu pago del estado de cuenta" })?.tipo).toBe("S5");
  });

  test("a bank statement that mentions cuotas is still S1", () => {
    expect(classifyByRules({ from: BANCO, subject: "Estado de cuenta: revisa tus cuotas" })?.tipo).toBe("S1");
  });

  test.each([
    [BANCO, "Actualizamos nuestros términos y condiciones"],
    [TIENDA, "Nuevos productos en Tienda Plaza"],
    [BANCO, "Te convencemos con este seguro"],
  ])("from %p with subject %p is left to the next step", (from, subject) => {
    expect(classifyByRules({ from, subject })).toBeNull();
  });

  test.each([
    "avisos@bancoandino.example.com",
    "avisos@banco-andino.example",
    "avisos@x.bancoandino.example",
    "avisos@bancoandin0.example",
  ])("does not classify mail from the look-alike %p", (from) => {
    expect(classifyByRules({ from, subject: "Tu estado de cuenta" })).toBeNull();
  });
});
