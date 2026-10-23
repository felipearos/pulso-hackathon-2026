import { describe, expect, test } from "bun:test";
import { checkText } from "../validator/validator";
import { madrugadaText, madrugadaTextOtraVez } from "./madrugada";

/**
 * A calm Spanish voice says about two and a half words a second; at two, with
 * the pauses between sentences, thirty-five words still fit in the 20 seconds a
 * madrugada note may last.
 */
const MAX_WORDS = 35;

/** Stems of money or a propuesta. */
const MONEY = ["peso", "mil", "pag", "mínimo", "propon", "apart", "tarjeta"];
/** Stems of a day or an hour: the next cita may be tomorrow or in three days. */
const WHEN = ["mañana", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo", "hora", "media"];

const TEXTS = { madrugadaText: madrugadaText("Patricia"), madrugadaTextOtraVez: madrugadaTextOtraVez("Patricia") };

describe("madrugada texts", () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    test(`${name} has no figure and passes the validador's code checks`, () => {
      expect(checkText(text, [])).toEqual([]);
    });

    test(`${name} fits a 20 second voice note`, () => {
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
    });

    test(`${name} proposes nothing and names no money, day or hour`, () => {
      const words = text.toLowerCase().split(/[^\p{L}]+/u);
      for (const stem of [...MONEY, ...WHEN]) {
        expect(words.filter((word) => word.startsWith(stem))).toEqual([]);
      }
      expect(text).not.toMatch(/[$?]/);
    });
  }

  test("both call her by her nombre, never a nickname", () => {
    for (const make of [madrugadaText, madrugadaTextOtraVez]) {
      expect(make("Patricia")).toContain("Patricia");
      expect(make("Paty")).toContain("Paty");
    }
  });
});
