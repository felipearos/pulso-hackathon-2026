import { describe, expect, test } from "bun:test";
import type { IncomingMail } from "../ports";
import { createTestApp } from "../testing";

const BANCO = "avisos@bancoandino.example";
const DECEMBER = new Date("2026-12-10T10:00:00-03:00");
const NOVEMBER = new Date("2026-11-10T10:00:00-03:00");

let nextId = 1;
function mail(from: string, subject: string, text = ""): IncomingMail {
  return { id: `cuotas-${nextId++}`, from, subject, text, receivedAt: new Date("2026-10-19T09:00:00-03:00"), links: [] };
}

describe("compras en cuotas through the app", () => {
  test("an S4 is registered without any outgoing message, also through Gmail and tick", async () => {
    const { app, clock, mail: gmail, whatsapp } = createTestApp();
    app.store.updatePatricia({ gmailPermitido: true });

    await app.receiveMail(mail(BANCO, "Tu compra en 3 cuotas en Farmacia Ejemplo"));
    gmail.inject({ from: BANCO, subject: "Tu compra en 6 cuotas en Zapatería Centro", receivedAt: clock.now() });
    await app.tick();

    expect(app.store.decisions().map((d) => (d.datos as { tipo: string }).tipo)).toEqual(["S4", "S4"]);
    expect(app.store.comprasEnCuotas().map((c) => [c.cuotas, c.comercio])).toEqual([
      [3, "Farmacia Ejemplo"],
      [6, "Zapatería Centro"],
    ]);
    expect(whatsapp.outbox).toEqual([]);
    expect(app.store.mensajesSalientes()).toEqual([]);
  });

  test("the compra keeps its cuotas, comercio and end month, and loses one cuota a month", async () => {
    const { app, clock } = createTestApp();
    await app.receiveMail(mail(BANCO, "Tu compra en 3 cuotas en Farmacia Ejemplo"));

    expect(app.store.comprasEnCuotas()).toEqual([
      expect.objectContaining({ cuotas: 3, comercio: "Farmacia Ejemplo", cuotasRestantes: 3, mesTermino: "enero" }),
    ]);

    clock.set(new Date("2026-11-19T09:00:00-03:00"));
    expect(app.store.comprasEnCuotas()).toEqual([
      expect.objectContaining({ cuotas: 3, cuotasRestantes: 2, mesTermino: "enero" }),
    ]);
  });

  test("the decision records cuotas, comercio and plataDeCarino without judgement", async () => {
    const { app } = createTestApp();
    await app.receiveMail(mail(BANCO, "Tu compra en 3 cuotas en Farmacia Ejemplo"));
    await app.receiveMail(mail(BANCO, "Compraste en cuotas"));

    const [conCuotas, sinCuotas] = app.store.decisions();
    expect(conCuotas!.datos).toMatchObject({
      tipo: "S4",
      cuotas: 3,
      comercio: "Farmacia Ejemplo",
      plataDeCarino: false,
    });
    expect(conCuotas!.motivo).toContain("Compra en 3 cuotas en Farmacia Ejemplo; Luna la anota y no la comenta.");
    expect(sinCuotas!.datos).toMatchObject({ tipo: "S4", plataDeCarino: false });
    expect(sinCuotas!.datos).not.toHaveProperty("cuotas");
    expect(sinCuotas!.motivo).toContain("El correo no dice en cuántas cuotas; Luna la anota igual y no la comenta.");
  });

  test("a December gift is plata de cariño; the same subject in November or a non-gift in December is not", async () => {
    const december = createTestApp({ now: DECEMBER });
    await december.app.receiveMail(mail(BANCO, "Ropa para tu nieto en 4 cuotas en Tienda Ejemplo"));
    await december.app.receiveMail(mail(BANCO, "Tu compra en 2 cuotas en Juguetería Ejemplo"));
    await december.app.receiveMail(mail(BANCO, "Tu compra en 3 cuotas en Farmacia Ejemplo"));

    const decisions = december.app.store.decisions();
    expect(decisions.map((d) => d.datos)).toEqual([
      expect.objectContaining({ tipo: "S4", cuotas: 4, plataDeCarino: true }),
      expect.objectContaining({ tipo: "S4", cuotas: 2, plataDeCarino: true }),
      expect.objectContaining({ tipo: "S4", cuotas: 3, plataDeCarino: false }),
    ]);
    expect(decisions[0]!.motivo).toContain("Es diciembre y parece un regalo: queda como plata de cariño.");
    expect(decisions[2]!.motivo).not.toContain("plata de cariño");
    expect(december.app.store.comprasEnCuotas().map((c) => c.plataDeCarino)).toEqual([true, true, false]);
    expect(december.whatsapp.outbox).toEqual([]);

    const november = createTestApp();
    november.clock.set(NOVEMBER);
    await november.app.receiveMail(mail(BANCO, "Ropa para tu nieto en 4 cuotas en Tienda Ejemplo"));
    expect(november.app.store.decisions()[0]!.datos).toMatchObject({ tipo: "S4", plataDeCarino: false });
    expect(november.app.store.comprasEnCuotas().map((c) => c.plataDeCarino)).toEqual([false]);
  });
});
