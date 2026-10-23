import type { CifrasExtraidas } from "../extractor";

/** Plain text of a fictional bank estado de cuenta, as a PDF-to-text dump reads. */
export const ESTADO_DE_CUENTA_8_TEXTO = `BANCO FICTICIO
ESTADO DE CUENTA TARJETA DE CRÉDITO
Tarjeta Ficticia Visa                         N° de tarjeta: XXXX XXXX XXXX 0000

Titular: Patricia

INFORMACIÓN GENERAL
Fecha de facturación          15/10/2026
Pagar hasta                   05/11/2026
Cupo total                    $800.000
Cupo utilizado                $686.000
Cupo disponible               $114.000

Tasa de interés mensual       3,10 %
Monto en mora                 $0

MONTO TOTAL FACTURADO A PAGAR            $650.000
MONTO MÍNIMO A PAGAR                     $41.900

PAGOS ANTERIORES
Fecha de pago    Vencimiento    Monto pagado    Estado
03/04/2026       05/04/2026     $37.000         Pagado a tiempo
02/05/2026       05/05/2026     $37.700         Pagado a tiempo
04/06/2026       05/06/2026     $38.500         Pagado a tiempo
03/07/2026       05/07/2026     $39.200         Pagado a tiempo
01/08/2026       05/08/2026     $40.000         Pagado a tiempo
04/09/2026       05/09/2026     $40.700         Pagado a tiempo
03/10/2026       05/10/2026     $41.300         Pagado a tiempo

DETALLE DE COMPRAS EN CUOTAS
Descripción          Cuota        Valor cuota
Refrigerador         10 de 12     $18.000
Zapatillas           03 de 03     $20.000

Pague a tiempo y evite intereses de mora.
Banco Ficticio. Documento de ejemplo sin valor comercial.
`;

/** What the extractor must read from `ESTADO_DE_CUENTA_8_TEXTO`. */
export const ESTADO_DE_CUENTA_8_CIFRAS: CifrasExtraidas = {
  pagoMinimo: 41900,
  totalFacturado: 650000,
  cupo: 800000,
  tasaMensual: 0.031,
  fechaVencimiento: "2026-11-05",
  fechaCierre: "2026-10-15",
  mora: 0,
  pagosAnteriores: [
    { monto: 37000, aTiempo: true },
    { monto: 37700, aTiempo: true },
    { monto: 38500, aTiempo: true },
    { monto: 39200, aTiempo: true },
    { monto: 40000, aTiempo: true },
    { monto: 40700, aTiempo: true },
    { monto: 41300, aTiempo: true },
  ],
  comprasEnCuotas: [
    { descripcion: "Refrigerador", cuotasRestantes: 2 },
    { descripcion: "Zapatillas", cuotasRestantes: 0 },
  ],
};
