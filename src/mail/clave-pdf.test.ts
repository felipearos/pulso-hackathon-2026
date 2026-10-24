import { describe, expect, test } from "bun:test";
import { HAIKU_MODEL } from "../claude-cli";
import { FakeLlm } from "../fakes";
import { claveDesdeRut, leerReglaDeClave, type ReglaDeClave } from "./clave-pdf";

const RUT = "12345678-5";

describe("claveDesdeRut", () => {
  test("rut-sin-dv gives the cuerpo digits", () => {
    expect(claveDesdeRut(RUT, "rut-sin-dv")).toBe("12345678");
  });

  test("rut-con-dv gives cuerpo and dv without hyphen", () => {
    expect(claveDesdeRut(RUT, "rut-con-dv")).toBe("123456785");
  });

  test("rut-con-dv uppercases a lowercase k", () => {
    expect(claveDesdeRut("11111112-k", "rut-con-dv")).toBe("11111112K");
  });

  test("primeros-n gives the first n cuerpo digits", () => {
    expect(claveDesdeRut(RUT, "primeros-n", 4)).toBe("1234");
  });

  test("ultimos-n gives the last n cuerpo digits, dv excluded", () => {
    expect(claveDesdeRut(RUT, "ultimos-n", 4)).toBe("5678");
  });

  test("n equal to the cuerpo length is allowed", () => {
    expect(claveDesdeRut(RUT, "primeros-n", 8)).toBe("12345678");
    expect(claveDesdeRut(RUT, "ultimos-n", 8)).toBe("12345678");
  });

  test("sin-clave is always null", () => {
    expect(claveDesdeRut(RUT, "sin-clave")).toBeNull();
  });

  test.each(["", "12.345.678-5", "123456785", "12a45678-5", "1234-5678-5", "12345678-", "-5", "12345678-55"])(
    "malformed rut %p gives null",
    (rut) => {
      expect(claveDesdeRut(rut, "rut-sin-dv")).toBeNull();
      expect(claveDesdeRut(rut, "rut-con-dv")).toBeNull();
    },
  );

  const reglasConN: ReglaDeClave[] = ["primeros-n", "ultimos-n"];
  for (const regla of reglasConN) {
    test.each([undefined, 0, -1, 2.5, Number.NaN, 9])(`${regla} with n %p gives null`, (n) => {
      expect(claveDesdeRut(RUT, regla, n)).toBeNull();
    });
  }
});

describe("leerReglaDeClave", () => {
  const cases: Array<[name: string, body: string, reply: string, expected: { regla: ReglaDeClave; n?: number } | null]> =
    [
      [
        "rut-sin-dv",
        "Su estado de cuenta va adjunto. Usa como contraseña tu RUT sin guión ni dígito verificador.",
        '{"regla":"rut-sin-dv","n":null}',
        { regla: "rut-sin-dv" },
      ],
      [
        "rut-con-dv",
        "Para abrir el archivo ingrese su RUT completo con dígito verificador, sin puntos ni guión.",
        '{"regla":"rut-con-dv","n":null}',
        { regla: "rut-con-dv" },
      ],
      [
        "primeros-n",
        "La clave del PDF son los primeros 4 dígitos de su RUT.",
        '{"regla":"primeros-n","n":4}',
        { regla: "primeros-n", n: 4 },
      ],
      [
        "ultimos-n",
        "La clave del PDF son los últimos 6 dígitos de su RUT, sin dígito verificador.",
        '{"regla":"ultimos-n","n":6}',
        { regla: "ultimos-n", n: 6 },
      ],
      [
        "an unencrypted attachment",
        "Adjuntamos su cartola. El documento no está protegido con clave.",
        '{"regla":"sin-clave","n":null}',
        { regla: "sin-clave" },
      ],
      [
        "a body saying nothing about claves",
        "Estimada clienta, adjuntamos su estado de cuenta del mes.",
        '{"regla":null,"n":null}',
        null,
      ],
    ];

  test.each(cases)("reads %s", async (_name, body, reply, expected) => {
    const llm = new FakeLlm([[body.slice(0, 30), reply]]);
    expect(await leerReglaDeClave(body, llm)).toEqual(expected);
  });

  test("ignores an n sent with a rule that takes none", async () => {
    const llm = new FakeLlm([["correo", '{"regla":"rut-sin-dv","n":4}']]);
    expect(await leerReglaDeClave("correo", llm)).toEqual({ regla: "rut-sin-dv" });
  });

  test("extracts the JSON from a reply with extra text", async () => {
    const llm = new FakeLlm([["correo", 'Aquí va: {"regla":"ultimos-n","n":4} listo']]);
    expect(await leerReglaDeClave("correo", llm)).toEqual({ regla: "ultimos-n", n: 4 });
  });

  test.each([
    ["a rule outside the list", '{"regla":"fecha-nacimiento","n":null}'],
    ["broken JSON", '{"regla":"rut-sin-dv",'],
    ["no JSON", "No sé"],
    ["primeros-n without n", '{"regla":"primeros-n","n":null}'],
    ["ultimos-n without n", '{"regla":"ultimos-n"}'],
    ["n = 0", '{"regla":"primeros-n","n":0}'],
    ["n = 2.5", '{"regla":"ultimos-n","n":2.5}'],
    ["n as a string", '{"regla":"primeros-n","n":"4"}'],
  ])("returns null on %s", async (_name, reply) => {
    const llm = new FakeLlm([["correo", reply]]);
    expect(await leerReglaDeClave("correo", llm)).toBeNull();
  });

  test("returns null on a port error", async () => {
    const llm = new FakeLlm([]);
    expect(await leerReglaDeClave("correo", llm)).toBeNull();
  });

  test("returns null on timeout", async () => {
    const llm = new FakeLlm([["correo", '{"regla":"rut-sin-dv","n":null}']]);
    const hold = llm.hold();
    expect(await leerReglaDeClave("correo", llm, { timeoutMs: 10 })).toBeNull();
    hold.release();
  });

  test("sends only the email text to Haiku, never the RUT nor the clave", async () => {
    const body = "Usa como contraseña tu RUT sin guión ni dígito verificador.";
    const llm = new FakeLlm([["contraseña", '{"regla":"rut-sin-dv","n":null}']]);
    const regla = await leerReglaDeClave(body, llm);
    expect(regla).toEqual({ regla: "rut-sin-dv" });
    expect(llm.calls).toHaveLength(1);
    const request = llm.calls[0]!;
    expect(request.model).toBe(HAIKU_MODEL);
    expect(request.prompt).toContain(JSON.stringify(body));
    const clave = claveDesdeRut(RUT, regla!.regla, regla!.n);
    const sent = `${request.system ?? ""}\n${request.prompt}`;
    expect(sent).not.toContain(RUT);
    expect(sent).not.toContain("12345678");
    expect(sent).not.toContain(clave!);
  });
});
