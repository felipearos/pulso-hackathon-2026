import { describe, expect, test } from "bun:test";
import { propuestaDelJueves, respuestaAEleccion, textoPropuesta, type Propuesta } from "./propuesta";

const CASO: Propuesta = { apartado: 8100, pagoMinimo: 41900, monto: 50000 };

describe("propuestaDelJueves", () => {
  test.each([
    [8100, 41900, 50000],
    [100, 41900, 42000],
    [8150, 41900, 51000],
    [0, 41900, null],
    [8100, null, null],
    [-1, 41900, null],
  ] as const)("apartado %p over mínimo %p proposes %p", (apartado, pagoMinimo, monto) => {
    const propuesta = propuestaDelJueves({ apartado, pagoMinimo });
    expect(propuesta).toEqual(monto === null ? null : { apartado, pagoMinimo: pagoMinimo!, monto });
  });

  test("a non-positive pago mínimo proposes nothing", () => {
    expect(propuestaDelJueves({ apartado: 8100, pagoMinimo: 0 })).toBeNull();
  });
});

describe("textoPropuesta", () => {
  test("the case's propuesta names the plata apartada, the figure and both emoji", () => {
    const texto = textoPropuesta(CASO);
    expect(texto).toBe("Esta semana llevas $8.100 apartados. ¿Pagas $50.000 👍 o el mínimo 👌?");
    for (const part of ["$8.100", "$50.000", "👍", "👌"]) expect(texto).toContain(part);
  });
});

describe("respuestaAEleccion", () => {
  const propuesta = respuestaAEleccion("propuesta", CASO);
  const minimo = respuestaAEleccion("minimo", CASO);

  test("both replies are the expected text", () => {
    expect(propuesta).toBe("Anotado: $50.000 este mes. Gracias por contarme, Patricia.");
    expect(minimo).toBe("Anotado: el mínimo este mes. Gracias por contarme, Patricia.");
  });

  test("both replies share the same closing", () => {
    const closing = (s: string) => s.slice(s.indexOf(" este mes."));
    expect(closing(propuesta)).toBe(closing(minimo));
  });

  test("neither reply compares one choice with the other", () => {
    for (const reply of [propuesta, minimo]) {
      for (const word of ["más", "mejor", "solo", "pero", "aunque", "debería"]) {
        expect(reply.toLowerCase()).not.toMatch(new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "u"));
      }
    }
  });

  test("only the propuesta reply carries a figure", () => {
    expect(propuesta).toMatch(/\$\d/);
    expect(minimo).not.toMatch(/\d/);
  });
});
