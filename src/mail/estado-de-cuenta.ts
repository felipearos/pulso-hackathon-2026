import type { Database } from "bun:sqlite";
import { extractCifras, type CifrasExtraidas } from "../figures/extractor";
import type { MinimumRule, Statement } from "../figures/payoff";
import type { EstadoDeCuenta, Extraccion } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail, Llm, Web } from "../ports";
import { documentText } from "../web/documento";
import { allowedLink } from "../web/link";
import { claveDesdeRut, enmascararRut, leerReglaDeClave } from "./clave-pdf";
import { allowedSender } from "./senders";

/**
 * How Banco Ficticio computes the pago mínimo. The rule is not printed on the
 * estado de cuenta, so it is configured per issuer instead of extracted.
 */
export const BANCO_FICTICIO_MINIMUM_RULE: MinimumRule = { percent: 0.0645, floor: 10_500, roundTo: 100 };

/**
 * How Tienda Plaza computes the pago mínimo. The rule is not printed on the
 * estado de cuenta, so it is configured per issuer instead of extracted.
 */
export const TIENDA_PLAZA_MINIMUM_RULE: MinimumRule = { percent: 0.05, floor: 5_000, roundTo: 100 };

/** How Luna names each figure when she tells why she keeps it to herself. */
const CAMPO_LABEL: Record<keyof CifrasExtraidas, string> = {
  pagoMinimo: "el pago mínimo",
  totalFacturado: "el total facturado",
  cupo: "el cupo",
  tasaMensual: "la tasa de interés",
  fechaVencimiento: "la fecha de vencimiento",
  fechaCierre: "la fecha de cierre",
  mora: "el monto en mora",
  pagosAnteriores: "los pagos anteriores",
  comprasEnCuotas: "las compras en cuotas",
};

function statementFrom(cifras: CifrasExtraidas, minimumRule: MinimumRule): Statement | null {
  if (cifras.totalFacturado === null || cifras.tasaMensual === null) return null;
  return {
    totalBilled: cifras.totalFacturado,
    monthlyRate: cifras.tasaMensual,
    minimumRule,
    // A mora not found stays unknown; it is never written as 0.
    ...(cifras.mora === null ? {} : { overdue: cifras.mora }),
  };
}

/** The next ciclo of that origen: the bank and the tienda each count their own. */
export function nextCiclo(store: Store, origen: EstadoDeCuenta["origen"]): number {
  return Math.max(0, ...store.estadosDeCuenta().filter((e) => e.origen === origen).map((e) => e.ciclo)) + 1;
}

/**
 * Stores read figures as the next estado de cuenta of their origen, with the
 * extraction under `mailId`. Every figure not found gets a `callar-cifra`
 * decision, so Luna never invents it. The caller runs it in a transaction.
 */
export function storeEstadoDeCuenta(
  store: Store,
  input: { origen: EstadoDeCuenta["origen"]; cifras: CifrasExtraidas; mailId: string },
): { estado: EstadoDeCuenta; extraccion: Extraccion } {
  const { origen, cifras, mailId } = input;
  const ciclo = nextCiclo(store, origen);
  const estado = store.addEstadoDeCuenta({
    origen,
    ciclo,
    fechaCierre: cifras.fechaCierre,
    fechaVencimiento: cifras.fechaVencimiento,
    cifras: statementFrom(cifras, origen === "banco" ? BANCO_FICTICIO_MINIMUM_RULE : TIENDA_PLAZA_MINIMUM_RULE),
    pagoMinimo: cifras.pagoMinimo,
  });
  const extraccion = store.addExtraccion({ estadoDeCuentaId: estado.id, mailId, cifras });
  const estadoLabel = origen === "banco" ? "el estado de cuenta" : "el estado de cuenta de la tienda";
  for (const campo of Object.keys(CAMPO_LABEL) as Array<keyof CifrasExtraidas>) {
    if (cifras[campo] !== null) continue;
    store.recordDecision({
      tipo: "callar-cifra",
      motivo: `Callo esta cifra: no encontré ${CAMPO_LABEL[campo]} en ${estadoLabel} del ciclo ${ciclo}.`,
      datos: { campo, mailId, estadoDeCuentaId: estado.id },
    });
  }
  return { estado, extraccion };
}

/**
 * The link an S2 mail's estado de cuenta is read from: the first of its links
 * on the domain of the tienda that sent it or a subdomain of it. Null when the
 * mail is not the tienda's or has no such link, so nothing else is followed.
 */
export function linkDelEstadoDeCuenta(mail: IncomingMail): URL | null {
  // Only the tienda's own mail: a bank mail Claude took for an S2 must not open the etapa 4 gate.
  const sender = allowedSender(mail.from);
  if (sender?.kind !== "tienda") return null;
  const domain = sender.domain;
  for (const link of mail.links) {
    const url = allowedLink(link, [domain]);
    if (url !== null) return url;
  }
  return null;
}

/** The text of an S2 mail's estado de cuenta, downloaded from its link; null when it could not be read. */
async function textoDeLaTienda(web: Web, mail: IncomingMail): Promise<string | null> {
  const link = linkDelEstadoDeCuenta(mail);
  const domain = allowedSender(mail.from)?.domain;
  if (link === null || domain === undefined) {
    console.error(`estado de cuenta: ${mail.id} has no link on its sender's domain; nothing fetched`);
    return null;
  }
  try {
    const text = await documentText(await web.fetchDocument(link.href, [domain]));
    if (text === null) console.error(`estado de cuenta: ${mail.id} links to a document with no text; nothing stored`);
    return text;
  } catch (error) {
    console.error(`estado de cuenta: ${mail.id} link could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Why an S1's PDF could not be opened; never carries the RUT or the clave. */
type CasoNoAbre = "sin-rut" | "clave-invalida" | "sin-clave-no-abre" | "clave-no-abre";

const MOTIVO_NO_ABRE: Record<CasoNoAbre, string> = {
  "sin-rut":
    "No abrí el estado de cuenta del banco: el correo dice que la clave sale del RUT y no tengo el RUT de Patricia.",
  "clave-invalida":
    "No abrí el estado de cuenta del banco: con el RUT guardado no pude armar la clave que pide el correo.",
  "sin-clave-no-abre":
    "No abrí el estado de cuenta del banco: el PDF pide una clave y el correo no dice cómo se arma.",
  "clave-no-abre":
    "No abrí el estado de cuenta del banco: la clave que pide el correo no abrió el PDF, y no pruebo otras.",
};

/**
 * The text of an S1 mail's attached PDF, opened with the one clave the mail's
 * rule makes from Patricia's RUT, or without a clave when the rule says so or
 * the mail does not say. Never tries another clave. The case when it did not open.
 */
async function textoDelAdjunto(
  store: Store,
  llm: Llm,
  mail: IncomingMail,
  bytes: Uint8Array,
): Promise<{ text: string } | { caso: CasoNoAbre }> {
  // One retry, as for the figures. Its null does not tell a failed call from a mail that
  // says nothing, so both are asked twice and two nulls open the PDF without a clave.
  const regla = (await leerReglaDeClave(mail.text, llm)) ?? (await leerReglaDeClave(mail.text, llm));
  const pdf = { contentType: "application/pdf", body: bytes };
  if (regla === null || regla.regla === "sin-clave") {
    const text = await documentText(pdf);
    return text === null ? { caso: "sin-clave-no-abre" } : { text };
  }
  const rut = store.getPatricia().rut;
  if (rut === undefined || rut === null || rut === "") return { caso: "sin-rut" };
  const clave = claveDesdeRut(rut, regla.regla, regla.n);
  if (clave === null) return { caso: "clave-invalida" };
  const text = await documentText(pdf, { clave });
  return text === null ? { caso: "clave-no-abre" } : { text };
}

function closedForMail(store: Store, mailId: string): boolean {
  return store
    .decisions()
    .some((d) => d.tipo === "no-abre-estado-de-cuenta" && (d.datos as { mailId?: unknown } | null)?.mailId === mailId);
}

/**
 * Reads the estado de cuenta of an S1 mail (the bank's, from its attached PDF,
 * or from its text when it has none) or an S2 mail (the tienda's, behind its
 * link) and stores it with its extraction. Every figure not found gets a
 * `callar-cifra` decision, so Luna never invents it. Null for any other mail,
 * for an S2 with no allowed link, and when the link could not be read or
 * Claude failed twice: then nothing is stored, so the mail can be read again.
 * "cerrado" when an S1's PDF could not be opened: one
 * `no-abre-estado-de-cuenta` decision says why, and the mail is not read
 * again. The stored extraction when it was read.
 */
export async function extractEstadoDeCuenta(
  deps: { store: Store; llm: Llm; db: Database; web: Web },
  mail: IncomingMail,
): Promise<Extraccion | "cerrado" | null> {
  const { store, llm, db, web } = deps;
  const tipo = store.senalForMail(mail.id)?.tipo;
  if (tipo !== "S1" && tipo !== "S2") return null;
  const existing = store.extraccionForMail(mail.id);
  if (existing !== null) return existing;

  const origen = tipo === "S1" ? "banco" : "tienda";
  const adjunto = origen === "banco" ? mail.adjuntos?.[0] : undefined;
  let text: string | null;
  if (adjunto !== undefined) {
    if (closedForMail(store, mail.id)) return "cerrado";
    const leido = await textoDelAdjunto(store, llm, mail, adjunto.bytes);
    if ("caso" in leido) {
      const { caso } = leido;
      console.error(`estado de cuenta: ${mail.id} PDF did not open (${caso}); mail closed`);
      return db.transaction(() => {
        // Another call may have read or closed this mail while the LLM answered.
        const won = store.extraccionForMail(mail.id);
        if (won !== null) return won;
        if (closedForMail(store, mail.id)) return "cerrado" as const;
        store.recordDecision({
          tipo: "no-abre-estado-de-cuenta",
          motivo: MOTIVO_NO_ABRE[caso],
          datos: { mailId: mail.id, caso },
        });
        return "cerrado" as const;
      })();
    }
    // The bank prints her RUT on the estado de cuenta; it never reaches the extractor's prompt.
    text = enmascararRut(leido.text);
  } else {
    text = origen === "banco" ? mail.text : await textoDeLaTienda(web, mail);
  }
  if (text === null) return null;
  // One retry: a failed call is not an estado de cuenta without figures.
  const cifras = (await extractCifras(text, llm)) ?? (await extractCifras(text, llm));
  if (cifras === null) {
    console.error(`estado de cuenta: ${mail.id} could not be read; nothing stored`);
    return null;
  }

  return db.transaction(() => {
    // Another call may have stored this mail while the LLM answered.
    const won = store.extraccionForMail(mail.id);
    if (won !== null) return won;

    const { extraccion } = storeEstadoDeCuenta(store, { origen, cifras, mailId: mail.id });
    return extraccion;
  })();
}
