import { describe, expect, test } from "bun:test";
import type { Intencion } from "../escalera/policy";
import { nochesDeLaSemana, pagosSobreElMinimo } from "./contadores";

const at = (iso: string) => new Date(`${iso}-03:00`);

type Cita = { fecha: string; estado: "programada" | "callada"; mensajeSalienteId: number | null };
type Saliente = { id: number; kind: "text" | "audio" | "image"; sentAt: Date };
type Entrante = { intencion: Intencion | null; receivedAt: Date };

const cita = (fecha: string, mensajeSalienteId: number | null, estado: Cita["estado"] = "programada"): Cita => ({
  fecha,
  estado,
  mensajeSalienteId,
});
const saliente = (id: number, iso: string, kind: Saliente["kind"] = "audio"): Saliente => ({ id, kind, sentAt: at(iso) });
const entrante = (kind: Intencion["kind"] | null, iso: string): Entrante => ({
  intencion: kind === null ? null : ({ kind } as Intencion),
  receivedAt: at(iso),
});

// Sunday night, end of the week of Monday 2026-10-19.
const NOW = at("2026-10-25T23:00:00");

describe("nochesDeLaSemana", () => {
  test("counts a week with one unheard night where Luna stayed silent", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-19", 1), cita("2026-10-21", 2), cita("2026-10-23", 3)],
      salientes: [
        saliente(1, "2026-10-19T21:00:00"),
        saliente(2, "2026-10-21T21:00:00"),
        saliente(3, "2026-10-23T21:00:00"),
      ],
      entrantes: [entrante("listened", "2026-10-19T21:10:00"), entrante("accepted", "2026-10-23T22:00:00")],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 3, escuchadas: 2, sinPresion: 1 });
  });

  test("an unheard night where Luna wrote again unprompted is not sin presión", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-21", 1)],
      salientes: [saliente(1, "2026-10-21T21:00:00"), saliente(2, "2026-10-22T10:00:00")],
      entrantes: [],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 1, escuchadas: 0, sinPresion: 0 });
  });

  test("the estado de cuenta image and the «Permitir» link that follow the cita are not pressure", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-21", 1)],
      salientes: [
        saliente(1, "2026-10-21T21:00:00"),
        saliente(2, "2026-10-21T21:01:00", "image"),
        saliente(3, "2026-10-21T21:02:00", "text"),
      ],
      entrantes: [],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 1, escuchadas: 0, sinPresion: 1 });
  });

  test("an angustia answer to the domingo cita counts as escuchada", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-25", 1)],
      salientes: [saliente(1, "2026-10-25T21:30:00")],
      entrantes: [{ intencion: { kind: "angustia", value: 3 }, receivedAt: at("2026-10-25T21:40:00") }],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 1, escuchadas: 1, sinPresion: 0 });
  });

  test("an unheard night where Luna only answered her still counts as sin presión", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-21", 1)],
      salientes: [saliente(1, "2026-10-21T21:00:00"), saliente(2, "2026-10-21T21:31:00")],
      entrantes: [entrante("hello", "2026-10-21T21:30:00")],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 1, escuchadas: 0, sinPresion: 1 });
  });

  test("a cita from last week is not counted", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-17", 1), cita("2026-10-21", 2)],
      salientes: [saliente(1, "2026-10-17T21:00:00"), saliente(2, "2026-10-21T21:00:00")],
      entrantes: [entrante("listened", "2026-10-17T21:05:00")],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 1, escuchadas: 0, sinPresion: 1 });
  });

  test("a callada cita and an unsent programada one are not counted", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-20", 1, "callada"), cita("2026-10-22", null)],
      salientes: [saliente(1, "2026-10-20T21:00:00")],
      entrantes: [],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 0, escuchadas: 0, sinPresion: 0 });
  });

  test("a cita whose mensaje saliente is missing is not counted", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-20", 9)],
      salientes: [],
      entrantes: [],
      now: NOW,
    });
    expect(result.conInvitacion).toBe(0);
  });

  test("an entrante with null intencion does not count as escuchada", () => {
    const result = nochesDeLaSemana({
      citas: [cita("2026-10-21", 1)],
      salientes: [saliente(1, "2026-10-21T21:00:00")],
      entrantes: [entrante(null, "2026-10-21T21:10:00")],
      now: NOW,
    });
    expect(result).toEqual({ conInvitacion: 1, escuchadas: 0, sinPresion: 1 });
  });
});

describe("pagosSobreElMinimo", () => {
  const S5 = (monto: number | null, iso: string) => ({ tipo: "S5" as const, monto, receivedAt: at(iso) });
  const estado = (pagoMinimo: number | null, iso: string) => ({ pagoMinimo, receivedAt: at(iso) });

  test("counts 3 pagos with 2 above the mínimo", () => {
    const result = pagosSobreElMinimo({
      senales: [
        S5(50_000, "2026-08-10T10:00:00"),
        S5(30_000, "2026-09-10T10:00:00"),
        S5(80_000, "2026-10-10T10:00:00"),
        { tipo: "S3", monto: 100_000, receivedAt: at("2026-10-11T10:00:00") },
      ],
      estadosDeCuenta: [
        estado(40_000, "2026-08-01T10:00:00"),
        estado(45_000, "2026-09-01T10:00:00"),
        estado(null, "2026-09-20T10:00:00"),
        estado(42_000, "2026-10-01T10:00:00"),
      ],
      now: NOW,
    });
    expect(result).toEqual({ sobreElMinimo: 2, pagos: 3, meta: { sobre: 2, de: 3 } });
  });

  test("a pago equal to the mínimo is not above it", () => {
    const result = pagosSobreElMinimo({
      senales: [S5(40_000, "2026-10-10T10:00:00")],
      estadosDeCuenta: [estado(40_000, "2026-10-01T10:00:00")],
      now: NOW,
    });
    expect(result).toMatchObject({ sobreElMinimo: 0, pagos: 1 });
  });

  test("a pago with no prior estado de cuenta is not counted", () => {
    const result = pagosSobreElMinimo({
      senales: [S5(90_000, "2026-09-10T10:00:00")],
      estadosDeCuenta: [estado(40_000, "2026-10-01T10:00:00")],
      now: NOW,
    });
    expect(result).toMatchObject({ sobreElMinimo: 0, pagos: 0 });
  });
});
