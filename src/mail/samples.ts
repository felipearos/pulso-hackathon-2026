import { estadoDeCuenta8PdfCifrado } from "../figures/fixtures/pdf";
import { PATRICIA_RUT_FICTICIO } from "../patricia/fixtures";
import type { IncomingMail } from "../ports";

/**
 * One fictional mail of each kind Patricia gets, with the case's figures.
 * Every sender, link and monto is invented; domains use `.example` (RFC 2606).
 */

/** The bank's rule for the PDF: «tu RUT sin guión ni dígito verificador». */
const CLAVE_DEL_PDF = PATRICIA_RUT_FICTICIO.split("-")[0]!;

export const SAMPLE_BANCO: IncomingMail = {
  id: "muestra-banco-estado",
  from: "Banco Ficticio <avisos@bancoficticio.example>",
  subject: "Tu estado de cuenta de octubre está disponible",
  // The bank sends only a notice: the figures of the 8th are in the encrypted PDF attached.
  // No verb such as «usa» near «contraseña»: suspiciousReason would mark the bank's own mail S7.
  text: [
    "Estimado(a) PATRICIA SOTO:",
    "",
    "Ya puedes revisar tu estado de cuenta de este mes.",
    "",
    "Por tu seguridad, el archivo PDF adjunto está encriptado.",
    "",
    "¿Cómo abrirlo?",
    "Tu contraseña es tu RUT sin guión ni dígito verificador.",
    "",
    "Recuerda:",
    "- Revisa tus movimientos y avísanos si no reconoces alguno.",
    "- Activa las notificaciones de compra en la app de Banco Ficticio.",
    "",
    "Beneficio del mes: 10% de descuento en farmacias adheridas pagando con tu Tarjeta Ficticia Visa.",
    "",
    "Banco Ficticio nunca te pedirá tus claves por correo, teléfono ni mensaje.",
    "",
    "Saludos cordiales,",
    "Banco Ficticio",
  ].join("\n"),
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: [],
  adjuntos: [
    {
      nombre: "EECC_TARJETA_0000.pdf",
      mimeType: "application/octet-stream",
      bytes: estadoDeCuenta8PdfCifrado(CLAVE_DEL_PDF),
    },
  ],
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
  from: "Catálogo Ejemplo <pedidos@catalogoejemplo.example>",
  subject: "Pagamos tu pedido del catálogo",
  text: "Tu clienta pagó el pedido N° 0000 del catálogo de primavera por $18.500. El pago ya está disponible.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://catalogoejemplo.example/pedidos/confirmacion"],
};

export const SAMPLE_CUOTAS: IncomingMail = {
  id: "muestra-compra-en-cuotas",
  from: "Banco Ficticio <avisos@bancoficticio.example>",
  subject: "Confirmamos tu compra en 6 cuotas",
  text: "Compra en Tienda Ejemplo por $36.000 con tu Tarjeta Ficticia Visa terminada en 0000, en 6 cuotas de $6.000.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoficticio.example/movimientos/compra"],
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
  from: "Catálogo Ejemplo <hola@catalogoejemplo.example>",
  subject: "Conoce el catálogo de primavera",
  text: "Mira las novedades de esta temporada.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://catalogoejemplo.example/catalogo/primavera"],
};

export const SAMPLE_FALSO: IncomingMail = {
  id: "muestra-banco-falso",
  from: "Banco Ficticio <avisos@bancoficticio.example>",
  subject: "Urgente: tu tarjeta será bloqueada",
  text: "Ingresa tu clave y el código que te enviamos por SMS para evitar el bloqueo.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoficticio-seguro.example/verificar"],
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
