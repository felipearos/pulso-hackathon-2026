import { describe, expect, test } from "bun:test";
import type { IncomingMail } from "../ports";
import { createTestApp } from "../testing";

const CATALOGO = "pedidos@catalogoaurora.example";
const TIENDA = "avisos@tiendaplaza.example";

let nextId = 1;
function mail(from: string, subject: string, text = ""): IncomingMail {
  return { id: `apartado-${nextId++}`, from, subject, text, receivedAt: new Date("2026-10-19T09:00:00-03:00"), links: [] };
}

describe("plata apartada through the app", () => {
  test("three S3 during the week add up their aportes, send nothing, and an S5 resets the total", async () => {
    const { app, clock, mail: gmail, whatsapp } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: true });

    app.receiveMail(mail(CATALOGO, "Pagamos tu pedido #1 por $30.000"));
    clock.set(new Date("2026-10-21T13:00:00-03:00"));
    app.receiveMail(mail(CATALOGO, "Pagamos tu pedido #2 por $27.000"));
    clock.set(new Date("2026-10-23T20:00:00-03:00"));
    gmail.inject({ from: CATALOGO, subject: "Pagamos tu pedido #3 por $24.000", receivedAt: clock.now() });
    await app.tick();

    const apartada = app.store.plataApartada();
    expect(apartada.total).toBe(8100);
    expect(apartada.aportes.map((a) => [a.monto, a.aporte])).toEqual([
      [30000, 3000],
      [27000, 2700],
      [24000, 2400],
    ]);
    expect(whatsapp.outbox).toEqual([]);
    expect(app.store.mensajesSalientes()).toEqual([]);

    app.receiveMail(mail(TIENDA, "¡Recibimos tu pago!"));
    expect(app.store.plataApartada()).toEqual({ total: 0, aportes: [] });
  });

  test("the amount is read from the body when the subject has none, and a mail with none adds 0", () => {
    const { app } = createTestApp();
    app.receiveMail(mail(CATALOGO, "Pagamos tu pedido #4", "Tu pedido de $18.500 ya está pagado."));
    app.receiveMail(mail(CATALOGO, "Pagamos tu pedido #5", "Gracias por tu compra."));

    expect(app.store.plataApartada().aportes.map((a) => [a.monto, a.aporte])).toEqual([[18500, 1900]]);
    expect(app.store.plataApartada().total).toBe(1900);
    const [conMonto, sinMonto] = app.store.decisions();
    expect(conMonto!.datos).toMatchObject({ tipo: "S3", monto: 18500, aporte: 1900 });
    expect(sinMonto!.datos).toMatchObject({ tipo: "S3", monto: null, aporte: 0 });
    expect(conMonto!.motivo).toContain("El pedido fue de $18.500; su 10 % ($1.900) suma a la plata apartada");
  });

  test("only S3 decisions carry monto and aporte", () => {
    const { app } = createTestApp();
    app.receiveMail(mail(CATALOGO, "Pagamos tu pedido #6 por $10.000"));
    app.receiveMail(mail(TIENDA, "¡Recibimos tu pago!"));
    app.receiveMail(mail("avisos@bancoandino.example", "Tu estado de cuenta de octubre"));

    const [s3, ...others] = app.store.decisions();
    expect(s3!.datos).toMatchObject({ tipo: "S3", monto: 10000, aporte: 1000 });
    expect(others.map((d) => (d.datos as { tipo: string }).tipo)).toEqual(["S5", "S1"]);
    for (const d of others) {
      expect(d.datos).not.toHaveProperty("monto");
      expect(d.datos).not.toHaveProperty("aporte");
    }
  });

  test("the next Monday at 00:00 the total is back to 0 without an S5", () => {
    const { app, clock } = createTestApp();
    clock.set(new Date("2026-10-25T23:59:00-03:00"));
    app.receiveMail(mail(CATALOGO, "Pagamos tu pedido #7 por $30.000"));
    expect(app.store.plataApartada().total).toBe(3000);

    clock.set(new Date("2026-10-26T00:00:00-03:00"));
    expect(app.store.plataApartada()).toEqual({ total: 0, aportes: [] });
  });
});
