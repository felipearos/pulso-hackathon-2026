import { ESTADO_DE_CUENTA_8_TEXTO } from "../figures/fixtures/estado-de-cuenta-8";
import type { IncomingMail } from "../ports";

/**
 * One fictional mail of each kind Patricia gets, with the case's figures.
 * Every sender, link and amount is invented; domains use `.example` (RFC 2606).
 */

export const SAMPLE_BANCO: IncomingMail = {
  id: "muestra-banco-estado",
  from: "Banco Andino <avisos@bancoandino.example>",
  subject: "Tu estado de cuenta de octubre está disponible",
  // The bank sends the estado de cuenta in the mail itself: this is the 8th.
  text: ESTADO_DE_CUENTA_8_TEXTO,
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoandino.example/estado/octubre"],
};

export const SAMPLE_TIENDA: IncomingMail = {
  id: "muestra-tienda-estado",
  from: "Tienda Plaza <cuenta@tiendaplaza.example>",
  subject: "Tu estado de cuenta ya está listo",
  // The tienda only links to it: the PDF behind the link is `estadoDeCuentaTiendaPdf()`.
  text: "Hola Patricia, ya puedes ver el resumen de tu Tarjeta Plaza de octubre en el link.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://www.tiendaplaza.example/cuenta/octubre/estado-de-cuenta.pdf"],
};

export const SAMPLE_PEDIDO: IncomingMail = {
  id: "muestra-pedido-catalogo-pagado",
  from: "Catálogo Aurora <pedidos@catalogoaurora.example>",
  subject: "Pagamos tu pedido del catálogo",
  text: "Tu clienta pagó el pedido N° 0000 del catálogo de primavera por $18.500. El pago ya está disponible.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://catalogoaurora.example/pedidos/confirmacion"],
};

export const SAMPLE_CUOTAS: IncomingMail = {
  id: "muestra-compra-en-cuotas",
  from: "Banco Andino <avisos@bancoandino.example>",
  subject: "Confirmamos tu compra en 6 cuotas",
  text: "Compra en Tienda Plaza por $38.000 con tu Tarjeta Andina Visa terminada en 0000, en 6 cuotas de $6.334.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoandino.example/movimientos/compra"],
};

export const SAMPLE_PAGO: IncomingMail = {
  id: "muestra-recibimos-tu-pago",
  from: "Tienda Plaza <cuenta@tiendaplaza.example>",
  subject: "Recibimos tu pago",
  text: "Registramos el pago de $18.200 de tu Tarjeta Plaza el 08/10/2026. Gracias.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://tiendaplaza.example/pagos/recibido"],
};

export const SAMPLE_PUBLICIDAD: IncomingMail = {
  id: "muestra-catalogo-publicidad",
  from: "Catálogo Aurora <hola@catalogoaurora.example>",
  subject: "Conoce el catálogo de primavera",
  text: "Mira las novedades de esta temporada.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://catalogoaurora.example/catalogo/primavera"],
};

export const SAMPLE_FALSO: IncomingMail = {
  id: "muestra-banco-falso",
  from: "Banco Andino <avisos@bancoandino.example>",
  subject: "Urgente: tu tarjeta será bloqueada",
  text: "Ingresa tu clave y el código que te enviamos por SMS para evitar el bloqueo.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoandino-seguro.example/verificar"],
};

export type SampleMailKind = "banco" | "tienda" | "pedido" | "cuotas" | "pago" | "publicidad" | "falso";

export const SAMPLE_MAILS = {
  banco: SAMPLE_BANCO,
  tienda: SAMPLE_TIENDA,
  pedido: SAMPLE_PEDIDO,
  cuotas: SAMPLE_CUOTAS,
  pago: SAMPLE_PAGO,
  publicidad: SAMPLE_PUBLICIDAD,
  falso: SAMPLE_FALSO,
} as const satisfies Readonly<Record<SampleMailKind, IncomingMail>>;
