import type { IncomingMail } from "../ports";

export const SAMPLE_BANCO: IncomingMail = {
  id: "muestra-banco-estado",
  from: "Banco Andino <avisos@bancoandino.example>",
  subject: "Tu estado de cuenta de octubre está disponible",
  text: "Ya puedes revisar el resumen de tu tarjeta del mes.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoandino.example/estado/octubre"],
};

export const SAMPLE_TIENDA: IncomingMail = {
  id: "muestra-tienda-estado",
  from: "Tienda Plaza <cuenta@tiendaplaza.example>",
  subject: "Tu estado de cuenta ya está listo",
  text: "",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://www.tiendaplaza.example/cuenta/octubre"],
};

export const SAMPLE_PEDIDO: IncomingMail = {
  id: "muestra-pedido-catalogo-pagado",
  from: "Catálogo Aurora <pedidos@catalogoaurora.example>",
  subject: "Pagamos tu pedido del catálogo",
  text: "El pago de tu pedido ya está disponible.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://catalogoaurora.example/pedidos/confirmacion"],
};

export const SAMPLE_CUOTAS: IncomingMail = {
  id: "muestra-compra-en-cuotas",
  from: "Banco Andino <avisos@bancoandino.example>",
  subject: "Confirmamos tu compra en 6 cuotas",
  text: "La compra quedó registrada en seis cuotas mensuales.",
  receivedAt: new Date("2026-10-23T20:00:00.000-03:00"),
  links: ["https://bancoandino.example/movimientos/compra"],
};

export const SAMPLE_PAGO: IncomingMail = {
  id: "muestra-recibimos-tu-pago",
  from: "Tienda Plaza <cuenta@tiendaplaza.example>",
  subject: "Recibimos tu pago",
  text: "Registramos el pago de tu cuenta. Gracias.",
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
