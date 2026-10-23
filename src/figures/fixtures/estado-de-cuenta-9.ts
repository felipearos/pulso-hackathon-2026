import type { CifrasExtraidas } from "../extractor";

/**
 * Plain text of the fictional bank estado de cuenta that follows the 8th, as a
 * PDF-to-text dump reads: she paid $50.000 instead of the minimum, so the
 * balance is (650.000 − 50.000) plus 3,10 % interest, plus the first cuota of
 * the story's two compras en cuotas (remedios and the ropa del nieto).
 */
export const ESTADO_DE_CUENTA_9_TEXTO = `BANCO FICTICIO
ESTADO DE CUENTA TARJETA DE CRÉDITO
Tarjeta Ficticia Visa                         N° de tarjeta: XXXX XXXX XXXX 0000

Titular: Patricia

INFORMACIÓN GENERAL
Fecha de facturación          15/11/2026
Pagar hasta                   05/12/2026
Cupo total                    $800.000
Cupo utilizado                $717.600
Cupo disponible               $82.400

Tasa de interés mensual       3,10 %
Monto en mora                 $0

MONTO TOTAL FACTURADO A PAGAR            $639.600
MONTO MÍNIMO A PAGAR                     $41.300

PAGOS ANTERIORES
Fecha de pago    Vencimiento    Monto pagado    Estado
02/05/2026       05/05/2026     $37.700         Pagado a tiempo
04/06/2026       05/06/2026     $38.500         Pagado a tiempo
03/07/2026       05/07/2026     $39.200         Pagado a tiempo
01/08/2026       05/08/2026     $40.000         Pagado a tiempo
04/09/2026       05/09/2026     $40.700         Pagado a tiempo
03/10/2026       05/10/2026     $41.300         Pagado a tiempo
03/11/2026       05/11/2026     $50.000         Pagado a tiempo

DETALLE DE COMPRAS EN CUOTAS
Descripción          Cuota        Valor cuota
Refrigerador         11 de 12     $18.000
Farmacia Ejemplo     01 de 03     $15.000
Tienda Ejemplo       01 de 06     $6.000

Pague a tiempo y evite intereses de mora.
Banco Ficticio. Documento de ejemplo sin valor comercial.
`;

/** What the extractor must read from `ESTADO_DE_CUENTA_9_TEXTO`. */
export const ESTADO_DE_CUENTA_9_CIFRAS: CifrasExtraidas = {
  pagoMinimo: 41300,
  totalFacturado: 639600,
  cupo: 800000,
  tasaMensual: 0.031,
  fechaVencimiento: "2026-12-05",
  fechaCierre: "2026-11-15",
  mora: 0,
  pagosAnteriores: [
    { monto: 37700, aTiempo: true },
    { monto: 38500, aTiempo: true },
    { monto: 39200, aTiempo: true },
    { monto: 40000, aTiempo: true },
    { monto: 40700, aTiempo: true },
    { monto: 41300, aTiempo: true },
    { monto: 50000, aTiempo: true },
  ],
  comprasEnCuotas: [
    { descripcion: "Refrigerador", cuotasRestantes: 1 },
    { descripcion: "Farmacia Ejemplo", cuotasRestantes: 2 },
    { descripcion: "Tienda Ejemplo", cuotasRestantes: 5 },
  ],
};
