/**
 * The imagen difuminada: her estado de cuenta rendered as a PNG where
 * everything is blurred except the line holding one cifra, so she sees the
 * real document and only the one number she needs.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

/** A rectangle in PNG pixel coordinates, origin top-left. */
export interface Recuadro {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The blurred page as PNG bytes, and the sharp box left in it. */
export interface ImagenDifuminada {
  png: Uint8Array;
  recuadro: Recuadro;
}

/** Render scale: PDF points to PNG pixels. */
export const ESCALA = 2;
/** Blur radius in pixels, strong enough that no text outside the recuadro reads. */
const BLUR_PX = 8;
/** Pixels added around the cifra's line on every side. */
const PADDING_PX = 6;

/** Page 1 of `pdf` rendered sharp as PNG bytes at `ESCALA`. */
export async function renderPagina(pdf: Uint8Array): Promise<Uint8Array> {
  const png = await renderPageAsImage(new Uint8Array(pdf), 1, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: ESCALA,
  });
  return new Uint8Array(png);
}

/**
 * Page 1 of `pdf` blurred except the text line that contains `cifra`.
 * Null when no text on the page contains it: never a sharp box on the wrong line.
 */
export async function imagenDifuminada(pdf: Uint8Array, cifra: string): Promise<ImagenDifuminada | null> {
  const recuadro = await recuadroDeCifra(pdf, cifra);
  if (!recuadro) return null;

  const nitida = await loadImage(await renderPagina(pdf));
  const canvas = createCanvas(nitida.width, nitida.height);
  const ctx = canvas.getContext("2d");

  ctx.filter = `blur(${BLUR_PX}px)`;
  ctx.drawImage(nitida, 0, 0);
  ctx.filter = "none";

  const { x, y, width, height } = recuadro;
  ctx.drawImage(nitida, x, y, width, height, x, y, width, height);
  ctx.strokeStyle = "rgba(40, 40, 40, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 6);
  ctx.stroke();

  return { png: new Uint8Array(await canvas.encode("png")), recuadro };
}

/** The pixel box of the whole line holding `cifra` on page 1, padded and clamped to the page. */
async function recuadroDeCifra(pdf: Uint8Array, cifra: string): Promise<Recuadro | null> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: ESCALA });
  const items = (await page.getTextContent()).items.flatMap((item) =>
    "str" in item ? [{ str: item.str, transform: item.transform as number[], width: item.width }] : [],
  );

  const conCifra = items.find((item) => item.str.includes(cifra));
  if (!conCifra) return null;
  const baseline = conCifra.transform[5] ?? 0;
  const linea = items.filter((item) => item.str.trim() !== "" && Math.abs((item.transform[5] ?? 0) - baseline) < 1);

  let left = Infinity;
  let right = -Infinity;
  let size = 0;
  for (const item of linea) {
    const x = item.transform[4] ?? 0;
    left = Math.min(left, x);
    right = Math.max(right, x + item.width);
    size = Math.max(size, Math.abs(item.transform[3] ?? 0));
  }

  // PDF space has its origin bottom-left; flip y into pixel space, origin top-left.
  const [viewLeft, , , viewTop] = page.view as [number, number, number, number];
  const pageWidth = Math.ceil(viewport.width);
  const pageHeight = Math.ceil(viewport.height);
  const x = Math.max(0, Math.floor((left - viewLeft) * ESCALA - PADDING_PX));
  const y = Math.max(0, Math.floor((viewTop - (baseline + size * 0.8)) * ESCALA - PADDING_PX));
  const width = Math.min(pageWidth, Math.ceil((right - viewLeft) * ESCALA + PADDING_PX)) - x;
  const height = Math.min(pageHeight, Math.ceil((viewTop - (baseline - size * 0.25)) * ESCALA + PADDING_PX)) - y;
  return { x, y, width, height };
}
