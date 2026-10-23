import { describe, expect, test } from "bun:test";
import { checkText, findFigures } from "../validator/validator";
import { MADRUGADA_MAX_WORDS, MADRUGADA_TEXT, MADRUGADA_TEXT_OTRA_VEZ } from "./madrugada";

const TEXTS = { MADRUGADA_TEXT, MADRUGADA_TEXT_OTRA_VEZ };

describe("madrugada texts", () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    test(`${name} has no figure and passes the validador's code checks`, () => {
      expect(findFigures(text)).toEqual([]);
      expect(checkText(text, [])).toEqual([]);
    });

    test(`${name} fits a 20 second voice note`, () => {
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(MADRUGADA_MAX_WORDS);
    });

    test(`${name} proposes nothing and names no money, day or hour`, () => {
      const words = text.toLowerCase().split(/[^\p{L}]+/u);
      for (const stem of ["peso", "mil", "pag", "mínimo", "propon", "apart", "tarjeta", "mañana", "lunes", "jueves", "domingo", "hora", "media"]) {
        expect(words.filter((word) => word.startsWith(stem))).toEqual([]);
      }
      expect(text).not.toMatch(/[$?]/);
    });
  }
});
