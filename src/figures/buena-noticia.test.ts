import { describe, expect, test } from "bun:test";
import { buenaNoticia, type DatosBuenaNoticia, type ReglaBuenaNoticia } from "./buena-noticia";

const empty: DatosBuenaNoticia = { pagosAnteriores: null, mora: null, comprasEnCuotas: null };

const rows: [string, DatosBuenaNoticia, ReglaBuenaNoticia, string][] = [
  [
    "estado de cuenta 8: seven months on time",
    { pagosAnteriores: Array(7).fill(true), mora: 0, comprasEnCuotas: [] },
    "pagos-a-tiempo",
    "llevas siete meses pagando a tiempo, no estás en DICOM",
  ],
  [
    "streak broken earlier counts only the trailing run",
    { pagosAnteriores: [false, true, true, true], mora: 0, comprasEnCuotas: null },
    "pagos-a-tiempo",
    "llevas tres meses pagando a tiempo, no estás en DICOM",
  ],
  [
    "twelve months still in words",
    { pagosAnteriores: Array(12).fill(true), mora: 0, comprasEnCuotas: null },
    "pagos-a-tiempo",
    "llevas doce meses pagando a tiempo, no estás en DICOM",
  ],
  [
    "fourteen months says more than a year",
    { pagosAnteriores: Array(14).fill(true), mora: 0, comprasEnCuotas: null },
    "pagos-a-tiempo",
    "llevas más de un año pagando a tiempo, no estás en DICOM",
  ],
  [
    "last month late with no mora",
    { pagosAnteriores: [true, true, false], mora: 0, comprasEnCuotas: null },
    "sin-mora",
    "estás al día, no estás en DICOM",
  ],
  [
    "no mora and unknown history",
    { ...empty, mora: 0 },
    "sin-mora",
    "estás al día, no estás en DICOM",
  ],
  [
    "unknown mora with a long streak never claims DICOM",
    { pagosAnteriores: Array(10).fill(true), mora: null, comprasEnCuotas: null },
    "calida",
    "qué bueno que estemos conversando",
  ],
  [
    "in mora with one cuota left",
    {
      pagosAnteriores: [true, false],
      mora: 35_000,
      comprasEnCuotas: [
        { descripcion: "la tele", cuotasRestantes: 2 },
        { descripcion: "la lavadora", cuotasRestantes: 1 },
      ],
    },
    "cuota-termina",
    "a la lavadora le queda una sola cuota",
  ],
  [
    "in mora with two cuotas left, ended ones ignored",
    {
      ...empty,
      mora: 35_000,
      comprasEnCuotas: [
        { descripcion: "las zapatillas", cuotasRestantes: 0 },
        { descripcion: "la tele", cuotasRestantes: 2 },
        { descripcion: "la cama", cuotasRestantes: 2 },
      ],
    },
    "cuota-termina",
    "a la tele le quedan dos cuotas",
  ],
  [
    "only ended or long cuotas is not a match",
    {
      ...empty,
      mora: 35_000,
      comprasEnCuotas: [
        { descripcion: "las zapatillas", cuotasRestantes: 0 },
        { descripcion: "la tele", cuotasRestantes: 6 },
      ],
    },
    "calida",
    "qué bueno que estemos conversando",
  ],
  [
    "a el contracts to al",
    { ...empty, mora: 35_000, comprasEnCuotas: [{ descripcion: "el refrigerador", cuotasRestantes: 1 }] },
    "cuota-termina",
    "al refrigerador le queda una sola cuota",
  ],
  ["all fields unknown", empty, "calida", "qué bueno que estemos conversando"],
  [
    "in mora with no cuotas",
    { pagosAnteriores: [true, true], mora: 35_000, comprasEnCuotas: [] },
    "calida",
    "qué bueno que estemos conversando",
  ],
];

describe("buenaNoticia", () => {
  test.each(rows)("%s", (_name, datos, regla, texto) => {
    const result = buenaNoticia(datos);
    expect(result).toEqual({ regla, texto });
    expect(result.texto).not.toMatch(/\d/);
    expect(result.texto).not.toMatch(/deuda|culpa|atrasad|debes|urgente/i);
    expect(result.texto).not.toMatch(/\.$/);
  });
});
