import { describe, expect, test } from "bun:test";
import { createTestApp } from "../testing";

const receivedAt = new Date("2026-10-19T08:00:00-03:00");

describe("receiveMail", () => {
  test("classifies the bank, store, catalogue, cuotas and payment mails, one decision each", async () => {
    const { app, mail } = createTestApp();
    mail.inject({ id: "s1", from: "Banco Andino <avisos@bancoandino.example>", subject: "Tu estado de cuenta de octubre", receivedAt });
    mail.inject({ id: "s2", from: "avisos@tiendaplaza.example", subject: "Estado de cuenta Tienda Plaza", receivedAt });
    mail.inject({ id: "s3", from: "pedidos@catalogoaurora.example", subject: "Pagamos tu pedido #1234", receivedAt });
    mail.inject({ id: "s4", from: "avisos@bancoandino.example", subject: "Tu compra en 6 cuotas", receivedAt });
    mail.inject({ id: "s5", from: "avisos@tiendaplaza.example", subject: "¡Recibimos tu pago!", receivedAt });
    await app.tick();

    expect(app.store.senales().map((s) => [s.origen.mailId, s.tipo])).toEqual([
      ["s1", "S1"],
      ["s2", "S2"],
      ["s3", "S3"],
      ["s4", "S4"],
      ["s5", "S5"],
    ]);
    const decisions = app.store.decisions();
    expect(decisions.map((d) => d.tipo)).toEqual(["senal", "senal", "senal", "senal", "senal"]);
    for (const d of decisions) expect(d.motivo).toContain("Remitente");
    expect(decisions[0]!.datos).toEqual({
      mailId: "s1",
      from: "Banco Andino <avisos@bancoandino.example>",
      subject: "Tu estado de cuenta de octubre",
      tipo: "S1",
    });
  });

  test("a catalogue promo is stored as ignorado with its decision", async () => {
    const { app, mail } = createTestApp();
    mail.inject({ id: "promo", from: "ofertas@catalogoaurora.example", subject: "Nueva campaña de otoño", receivedAt });
    await app.tick();
    expect(app.store.senales().map((s) => s.tipo)).toEqual(["ignorado"]);
    expect(app.store.decisions()).toHaveLength(1);
    expect(app.store.decisions()[0]!.motivo).not.toBe("");
  });

  test("a mail the rules cannot tell is stored as ignorado with a motivo saying so", () => {
    const { app } = createTestApp();
    const senal = app.receiveMail({
      id: "x", from: "avisos@bancoandino.example", subject: "Actualiza tus datos", text: "", receivedAt, links: [],
    });
    expect(senal?.tipo).toBe("ignorado");
    expect(app.store.decisions()[0]!.motivo).toContain("reglas no supieron");
  });

  test("off-list and look-alike senders store nothing and record nothing", async () => {
    const { app, mail } = createTestApp();
    mail.inject({ from: "amiga@correo.example", subject: "Estado de cuenta", receivedAt });
    mail.inject({ from: "avisos@bancoandino.example.fraude.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    expect(app.receiveMail({
      id: "direct", from: "avisos@bancoandin0.example", subject: "Estado de cuenta", text: "", receivedAt, links: [],
    })).toBeNull();
    expect(app.store.senales()).toEqual([]);
    expect(app.store.decisions()).toEqual([]);
  });

  test("the same mail seen twice gives one señal and one decision", async () => {
    const { app, mail } = createTestApp();
    mail.inject({ id: "dup", from: "avisos@bancoandino.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    mail.inject({ id: "dup", from: "avisos@bancoandino.example", subject: "Estado de cuenta", receivedAt });
    await app.tick();
    expect(app.store.senales()).toHaveLength(1);
    expect(app.store.decisions()).toHaveLength(1);
  });

  test("calling the entry twice with the same mail returns the same señal", () => {
    const { app } = createTestApp();
    const incoming = { id: "twice", from: "avisos@tiendaplaza.example", subject: "Recibimos tu pago", text: "", receivedAt, links: [] };
    const first = app.receiveMail(incoming);
    const second = app.receiveMail(incoming);
    expect(second).toEqual(first);
    expect(app.store.senales()).toHaveLength(1);
    expect(app.store.decisions()).toHaveLength(1);
  });

  test("a failing mail port does not make tick throw", async () => {
    const { app, mail } = createTestApp();
    mail.fetchNew = async () => {
      throw new Error("gmail caído");
    };
    const original = console.error;
    console.error = () => {};
    try {
      await app.tick();
    } finally {
      console.error = original;
    }
    expect(app.store.senales()).toEqual([]);
  });

  test("a mail whose decision fails leaves no señal and the batch goes on", async () => {
    const { app, mail } = createTestApp();
    const record = app.store.recordDecision;
    let calls = 0;
    app.store.recordDecision = (input) => {
      calls += 1;
      if (calls === 1) throw new Error("registro lleno");
      return record(input);
    };
    mail.inject({ id: "first", from: "avisos@bancoandino.example", subject: "Estado de cuenta", receivedAt });
    mail.inject({ id: "second", from: "avisos@tiendaplaza.example", subject: "Recibimos tu pago", receivedAt });
    const original = console.error;
    console.error = () => {};
    try {
      await app.tick();
    } finally {
      console.error = original;
    }
    expect(app.store.senales().map((s) => s.origen.mailId)).toEqual(["second"]);
    expect(app.store.decisions()).toHaveLength(1);
  });
});
