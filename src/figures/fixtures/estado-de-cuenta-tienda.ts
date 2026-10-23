import type { CifrasExtraidas } from "../extractor";

/**
 * Plain text of the fictional Tienda Plaza estado de cuenta, the PDF behind
 * the S2 mail's link. Laid out unlike the bank's on purpose: other labels
 * («Deuda total», «Pago mínimo del mes»), colons, and payments without a
 * vencimiento column, so the extractor is tried on a second format.
 */
export const ESTADO_DE_CUENTA_TIENDA_TEXTO = `TIENDA PLAZA
Tarjeta Plaza · Resumen mensual de tu cuenta

Cliente: Patricia
Cuenta N°: 0000-000000

RESUMEN DE TU CUENTA
Fecha de cierre: 20/10/2026
Fecha límite de pago: 10/11/2026
Cupo de compra: $450.000
Deuda total: $368.000
Saldo atrasado: $0
Interés mensual: 2,95 %

PAGO MÍNIMO DEL MES: $18.400

TUS ÚLTIMOS PAGOS (todos antes de su fecha límite)
08/08/2026   $17.600
09/09/2026   $17.900
08/10/2026   $18.200

TUS COMPRAS EN CUOTAS
Colchón 2 plazas ........ cuota 8 de 12 ... $21.000
Juguera ................. cuota 4 de 6 .... $6.500

Tienda Plaza. Documento de ejemplo sin valor comercial.
`;

/** What the extractor must read from `ESTADO_DE_CUENTA_TIENDA_TEXTO`. */
export const ESTADO_DE_CUENTA_TIENDA_CIFRAS: CifrasExtraidas = {
  pagoMinimo: 18400,
  totalFacturado: 368000,
  cupo: 450000,
  tasaMensual: 0.0295,
  fechaVencimiento: "2026-11-10",
  fechaCierre: "2026-10-20",
  mora: 0,
  pagosAnteriores: [
    { monto: 17600, aTiempo: true },
    { monto: 17900, aTiempo: true },
    { monto: 18200, aTiempo: true },
  ],
  comprasEnCuotas: [
    { descripcion: "Colchón 2 plazas", cuotasRestantes: 4 },
    { descripcion: "Juguera", cuotasRestantes: 2 },
  ],
};
