import { describe, expect, test } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { extractText } from "unpdf";
import { ESTADO_DE_CUENTA_8_TEXTO } from "./fixtures/estado-de-cuenta-8";
import { estadoDeCuenta8Pdf } from "./fixtures/pdf";
import { ESCALA, imagenDifuminada, renderPagina, type Recuadro } from "./imagen-difuminada";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** RGBA pixels of a PNG. */
async function pixels(png: Uint8Array): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** Red channel values inside `box` (the page is greyscale text on white). */
function region(img: { data: Uint8ClampedArray; width: number }, box: Recuadro): number[] {
  const values: number[] = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) values.push(img.data[(y * img.width + x) * 4] ?? 255);
  }
  return values;
}

const nearBlack = (values: number[]) => values.filter((v) => v < 100).length;

/** Pixel box of the glyphs (baseline to cap height) of the fixture line starting with `prefix`. */
function lineaDelFixture(prefix: string): Recuadro {
  const index = ESTADO_DE_CUENTA_8_TEXTO.split("\n").findIndex((line) => line.startsWith(prefix));
  const baseline = 800 - 12 * index;
  return { x: 40 * ESCALA, y: (842 - baseline - 7) * ESCALA, width: 300 * ESCALA, height: 7 * ESCALA };
}

describe("estadoDeCuenta8Pdf", () => {
  test("round-trips its text through a PDF reader", async () => {
    const { text } = await extractText(estadoDeCuenta8Pdf(), { mergePages: true });
    expect(text).toContain("MONTO MÍNIMO A PAGAR");
    expect(text).toContain("$41.900");
  });
});

describe("imagenDifuminada", () => {
  test("keeps the cifra's line sharp and blurs every other line", async () => {
    const pdf = estadoDeCuenta8Pdf();
    const imagen = await imagenDifuminada(pdf, "$41.900");
    if (!imagen) throw new Error("expected an imagen");
    expect(Array.from(imagen.png.subarray(0, 8))).toEqual(PNG_SIGNATURE);

    const blurred = await pixels(imagen.png);
    const sharp = await pixels(await renderPagina(pdf));
    expect(blurred.width).toBe(sharp.width);
    expect(blurred.height).toBe(sharp.height);

    const { recuadro } = imagen;
    const inside = { x: recuadro.x + 3, y: recuadro.y + 3, width: recuadro.width - 6, height: recuadro.height - 6 };
    const insideBlurred = region(blurred, inside);
    expect(insideBlurred).toEqual(region(sharp, inside));
    expect(nearBlack(insideBlurred)).toBeGreaterThan(100);

    const otherLine = lineaDelFixture("MONTO TOTAL FACTURADO");
    expect(otherLine.y + otherLine.height).toBeLessThanOrEqual(recuadro.y);
    expect(nearBlack(region(sharp, otherLine))).toBeGreaterThan(100);
    expect(nearBlack(region(blurred, otherLine))).toBe(0);
  });

  test("the recuadro is a strip over the cifra's line", async () => {
    const imagen = await imagenDifuminada(estadoDeCuenta8Pdf(), "$41.900");
    if (!imagen) throw new Error("expected an imagen");
    const { recuadro } = imagen;
    const linea = lineaDelFixture("MONTO MÍNIMO A PAGAR");
    const cifraX = (40 + 6 * "MONTO MÍNIMO A PAGAR                     ".length) * ESCALA;
    const centerY = linea.y + linea.height / 2;

    expect(recuadro.x).toBeLessThanOrEqual(linea.x);
    expect(recuadro.x + recuadro.width).toBeGreaterThan(cifraX + 7 * 6 * ESCALA);
    expect(recuadro.y).toBeLessThan(centerY);
    expect(recuadro.y + recuadro.height).toBeGreaterThan(centerY);
    expect(recuadro.height).toBeLessThan(842 * ESCALA * 0.05);
  });

  test("resolves null when no text holds the cifra", async () => {
    expect(await imagenDifuminada(estadoDeCuenta8Pdf(), "$99.999")).toBeNull();
  });
});
