import type { Database } from "bun:sqlite";
import { extractCifras, type CifrasExtraidas } from "../figures/extractor";
import type { MinimumRule, Statement } from "../figures/payoff";
import type { Extraccion } from "../patricia/entities";
import type { Store } from "../patricia/store";
import type { IncomingMail, Llm } from "../ports";

/**
 * How Banco Andino computes the pago mínimo. The rule is not printed on the
 * estado de cuenta, so it is configured per issuer instead of extracted.
 */
export const BANCO_ANDINO_MINIMUM_RULE: MinimumRule = { percent: 0.0645, floor: 10_500, roundTo: 100 };

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

function statementFrom(cifras: CifrasExtraidas): Statement | null {
  if (cifras.totalFacturado === null || cifras.tasaMensual === null) return null;
  return {
    totalBilled: cifras.totalFacturado,
    monthlyRate: cifras.tasaMensual,
    minimumRule: BANCO_ANDINO_MINIMUM_RULE,
    // A mora not found stays unknown; it is never written as 0.
    ...(cifras.mora === null ? {} : { overdue: cifras.mora }),
  };
}

/**
 * Reads the estado de cuenta of an S1 mail and stores it with its extraction.
 * Every figure not found gets a `callar-cifra` decision, so Luna never invents
 * it. Null for any other mail, and when Claude failed twice: then nothing is
 * stored, so the mail can be read again. The stored extraction when it was read.
 */
export async function extractEstadoDeCuenta(
  deps: { store: Store; llm: Llm; db: Database },
  mail: IncomingMail,
): Promise<Extraccion | null> {
  const { store, llm, db } = deps;
  if (store.senalForMail(mail.id)?.tipo !== "S1") return null;
  const existing = store.extraccionForMail(mail.id);
  if (existing !== null) return existing;

  // One retry: a failed call is not an estado de cuenta without figures.
  const cifras = (await extractCifras(mail.text, llm)) ?? (await extractCifras(mail.text, llm));
  if (cifras === null) {
    console.error(`estado de cuenta: ${mail.id} could not be read; nothing stored`);
    return null;
  }

  return db.transaction(() => {
    // Another call may have stored this mail while the LLM answered.
    const won = store.extraccionForMail(mail.id);
    if (won !== null) return won;

    const ciclo = Math.max(0, ...store.estadosDeCuenta().filter((e) => e.origen === "banco").map((e) => e.ciclo)) + 1;
    const estado = store.addEstadoDeCuenta({
      origen: "banco",
      ciclo,
      fechaCierre: cifras.fechaCierre,
      fechaVencimiento: cifras.fechaVencimiento,
      cifras: statementFrom(cifras),
      pagoMinimo: cifras.pagoMinimo,
    });
    const extraccion = store.addExtraccion({ estadoDeCuentaId: estado.id, mailId: mail.id, cifras });
    for (const campo of Object.keys(CAMPO_LABEL) as Array<keyof CifrasExtraidas>) {
      if (cifras[campo] !== null) continue;
      store.recordDecision({
        tipo: "callar-cifra",
        motivo: `Callo esta cifra: no encontré ${CAMPO_LABEL[campo]} en el estado de cuenta del ciclo ${ciclo}.`,
        datos: { campo, mailId: mail.id, estadoDeCuentaId: estado.id },
      });
    }
    return extraccion;
  })();
}
