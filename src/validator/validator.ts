/**
 * The validador: every text Patricia receives (WhatsApp text, audio script)
 * passes through here before it is sent. Code checks that every figure was
 * computed by the motor de cifras, that there is at most one, and that no
 * reproach, urgency or blame word slipped in; then Claude Haiku reviews the
 * tone. A rejected draft is redrafted once; if that fails too, the plantilla
 * segura goes out and a decision records why.
 */

import type { Llm } from "../ports";

export const TONE_REVIEW_MODEL = "claude-haiku-5-5";

/** Calm, no figure, no forbidden word: what goes out when both drafts fail. */
export const SAFE_TEMPLATE =
  "Hoy no te traigo números. Cuando quieras, aquí estoy para mirarlo juntas, con calma.";

/**
 * Reproach, urgency and blame. «deuda» alone is not here: «la deuda baja» is
 * neutral and good news; only the forms that point at her («tu deuda»,
 * «endeudada») are blame.
 */
export const FORBIDDEN_WORDS: readonly string[] = [
  "deberías",
  "debiste",
  "tienes que",
  "urgente",
  "urgencia",
  "inmediatamente",
  "ahora mismo",
  "ya mismo",
  "último aviso",
  "irresponsable",
  "culpa",
  "tu deuda",
  "tus deudas",
  "endeudada",
  "endeudarte",
];

export type Rejection =
  | { kind: "figure-not-allowed"; figure: number }
  | { kind: "too-many-figures"; figures: number[] }
  | { kind: "forbidden-word"; word: string }
  | { kind: "tone"; reason: string };

export type ValidatorDecision = {
  kind: "safe-template";
  reason: string;
  input: { draft: string; redraft: string; rejections: Rejection[] };
};

export type ValidatedText = {
  text: string;
  source: "draft" | "redraft" | "safe-template";
};

export type ValidateInput = {
  draft: string;
  /** Figures the motor de cifras computed for this decision. */
  allowedFigures: readonly number[];
  llm: Llm;
  redraft: (rejections: Rejection[]) => Promise<string>;
  safeTemplate: string;
  recordDecision: (decision: ValidatorDecision) => void;
};

/** Thousands with dots (`1.250.000`), then plain digits, each with an optional decimal comma. */
const FIGURE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

/** The numbers written with digits in a Spanish (Chile) text. Dates count: `15/11` is 15 and 11. */
export function findFigures(text: string): number[] {
  return [...text.matchAll(FIGURE)].map((m) => Number(m[0].replaceAll(".", "").replace(",", ".")));
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const FORBIDDEN_PATTERNS = FORBIDDEN_WORDS.map((word) => ({
  word,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])${normalize(word).replaceAll(" ", "\\s+")}(?![\\p{L}\\p{N}])`, "u"),
}));

/** The deterministic checks; every reason, empty when the text passes. */
export function checkText(text: string, allowedFigures: readonly number[]): Rejection[] {
  const rejections: Rejection[] = [];
  const figures = [...new Set(findFigures(text))];
  for (const figure of figures) {
    if (!allowedFigures.includes(figure)) rejections.push({ kind: "figure-not-allowed", figure });
  }
  if (figures.length > 1) rejections.push({ kind: "too-many-figures", figures });
  const normalized = normalize(text);
  for (const { word, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) rejections.push({ kind: "forbidden-word", word });
  }
  return rejections;
}

const TONE_SYSTEM = [
  "Revisas mensajes para Patricia, una persona que dejó de mirar sus cuentas por miedo.",
  "Responde exactamente OK si el texto es tranquilo, cálido y no tiene reproche, urgencia ni culpa.",
  "Si no, responde NO: <motivo>.",
].join(" ");

async function reviewTone(llm: Llm, text: string): Promise<Rejection[]> {
  const reply = await llm.complete({ model: TONE_REVIEW_MODEL, system: TONE_SYSTEM, prompt: text });
  return reply.trim().startsWith("OK") ? [] : [{ kind: "tone", reason: reply.trim() }];
}

/** Code checks first; the LLM is only asked when they pass. */
async function check(llm: Llm, text: string, allowedFigures: readonly number[]): Promise<Rejection[]> {
  const rejections = checkText(text, allowedFigures);
  return rejections.length > 0 ? rejections : reviewTone(llm, text);
}

function describeRejection(rejection: Rejection): string {
  switch (rejection.kind) {
    case "figure-not-allowed":
      return `cifra ${rejection.figure} no calculada`;
    case "too-many-figures":
      return `más de una cifra (${rejection.figures.join(", ")})`;
    case "forbidden-word":
      return `palabra prohibida «${rejection.word}»`;
    case "tone":
      return `tono: ${rejection.reason}`;
  }
}

/** Draft, then one redraft, then the plantilla segura. */
export async function validateText(input: ValidateInput): Promise<ValidatedText> {
  const templateRejections = checkText(input.safeTemplate, []);
  if (templateRejections.length > 0) {
    throw new Error(`Safe template does not pass the validator: ${templateRejections.map(describeRejection).join("; ")}`);
  }

  const draftRejections = await check(input.llm, input.draft, input.allowedFigures);
  if (draftRejections.length === 0) return { text: input.draft, source: "draft" };

  const redraft = await input.redraft(draftRejections);
  const redraftRejections = await check(input.llm, redraft, input.allowedFigures);
  if (redraftRejections.length === 0) return { text: redraft, source: "redraft" };

  const rejections = [...draftRejections, ...redraftRejections];
  input.recordDecision({
    kind: "safe-template",
    reason: `El texto se rechazó dos veces (${rejections.map(describeRejection).join("; ")}); salió la plantilla segura sin cifra.`,
    input: { draft: input.draft, redraft, rejections },
  });
  return { text: input.safeTemplate, source: "safe-template" };
}
