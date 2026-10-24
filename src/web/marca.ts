/*
 * Luna's brand for the pages Patricia and the jurado open: the open envelope
 * with the moon rising out of it («Yo lo abro por ti») and the «Noche tibia»
 * palette. The static pages in src/web/pages and src/demo carry the same
 * logo and favicon inline; keep them in step.
 */

export const NOCHE = "#232E78";
export const LUNA = "#F2B33D";
export const PAPEL = "#FBF8F1";
export const ARENA = "#F3EDE1";
export const TINTA = "#17181C";
export const TINTA_2 = "#45474F";

/** The envelope and the moon, on a 96×96 grid; `maskId` must be unique within the page. */
function glyph(maskId: string): string {
  return [
    `<defs><mask id="${maskId}"><rect width="96" height="96" fill="#fff"/><circle cx="56" cy="31" r="12" fill="#000"/></mask></defs>`,
    `<path d="M19 50 L48 28 L77 50" fill="none" stroke="${PAPEL}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="46" cy="38.5" r="16" fill="${LUNA}" mask="url(#${maskId})"/>`,
    `<rect x="19" y="50" width="58" height="27" rx="6" fill="${NOCHE}" stroke="${PAPEL}" stroke-width="4.5"/>`,
    `<path d="M22 74.5 L48 59 L74 74.5" fill="none" stroke="${PAPEL}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" opacity=".5"/>`,
  ].join("");
}

/** The app icon: the glyph on a rounded Noche square. Decorative, so hidden from screen readers. */
export function logoIcon(maskId = "luna-logo"): string {
  return `<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><rect width="96" height="96" rx="26" fill="${NOCHE}"/>${glyph(maskId)}</svg>`;
}

/** The WhatsApp avatar: the glyph a little smaller on a full square, for a round frame. */
export function logoAvatar(maskId = "luna-avatar"): string {
  return `<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><rect width="96" height="96" fill="${NOCHE}"/><g transform="translate(48 51) scale(.84) translate(-48 -51)">${glyph(maskId)}</g></svg>`;
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="26" fill="${NOCHE}"/>${glyph("f")}</svg>`;

/** The favicon on its own, for the operator's pages. */
export const FAVICON_LINK = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}">`;

/** The `<head>` lines every branded page shares: the favicon and the two fonts. */
export const MARCA_HEAD = [
  FAVICON_LINK,
  `<link rel="preconnect" href="https://fonts.googleapis.com">`,
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
  `<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet">`,
].join("");
