import { describe, expect, test } from "bun:test";
import { isAllowedLinkHost, suspiciousReason } from "./suspicious";

const allowed = { senderAllowed: true };
const DATA_REQUEST = "El correo pide o intenta confirmar datos privados. No abrimos sus links.";
const PDF_PASSWORD = "Por tu seguridad, el archivo PDF adjunto está encriptado. Usa como contraseña tu RUT sin guión ni dígito verificador.";

describe("suspiciousReason", () => {
  test.each([
    ["off-list host", ["https://cupones.example/oferta"]],
    ["a domain that imitates the bank", ["https://bancoficticio-seguro.example/verificar"]],
    ["an allowed domain followed by a fraudulent domain", ["https://bancoficticio.example.fraude.example/verificar"]],
    ["a one-character look-alike", ["https://bancofictici0.example/verificar"]],
    ["an unparseable link", ["no es una URL"]],
  ])("flags %s", (_name, links) => {
    expect(suspiciousReason({ subject: "Aviso", text: "Información de tu cuenta", links }, allowed)).not.toBeNull();
  });

  test("says when an off-list host imitates an allowed sender", () => {
    expect(suspiciousReason({ subject: "Aviso", text: "", links: ["https://bancoficticio-seguro.example"] }, allowed)).toContain(
      "imita al banco",
    );
  });

  test.each([
    ["clave", "Ingresa tu clave"],
    ["claves", "Ingresa tus claves"],
    ["contraseña", "Comparte tu contraseña"],
    ["PIN", "Confirma tu PIN"],
    ["código de verificación", "Ingresa el código de verificación"],
    ["código SMS", "Ingresa el código SMS"],
    ["código por SMS", "Ingresa el código que te enviamos por SMS"],
    ["código de seguridad", "Ingresa el código de seguridad"],
    ["tarjeta de coordenadas", "Usa tu tarjeta de coordenadas"],
    ["CVV", "Confirma el CVV de tu tarjeta"],
    ["actualiza tus datos", "Actualiza tus datos para continuar"],
    ["confirma tus datos", "Confirma tus datos para continuar"],
    ["verifica tu cuenta", "Verifica tu cuenta para continuar"],
  ])("flags a request for %s", (_name, text) => {
    expect(suspiciousReason({ subject: "Aviso de cuenta", text, links: [] }, allowed)).not.toBeNull();
  });

  test("flags a request for secret data in the subject", () => {
    expect(suspiciousReason({ subject: "Confirma tus datos para seguir", text: "Aviso de cuenta", links: [] }, allowed)).not.toBeNull();
  });

  test("allows an approved sender subdomain", () => {
    expect(isAllowedLinkHost("www.tiendaplaza.example")).toBe(true);
    expect(suspiciousReason({ subject: "Aviso", text: "Tu cuenta está disponible", links: ["https://www.tiendaplaza.example/cuenta"] }, allowed)).toBeNull();
  });

  test.each([
    "bancoficticio.example.fraude.example",
    "bancoficticio-seguro.example",
    "bancofictici0.example",
  ])("does not allow the look-alike host %s", (host) => {
    expect(isAllowedLinkHost(host)).toBe(false);
  });

  test.each([
    ["clavel", "El clavel quedó en el catálogo."],
    ["código de producto", "Este código de producto identifica el artículo."],
  ])("does not flag harmless text containing %s", (_name, text) => {
    expect(suspiciousReason({ subject: "Información", text, links: [] }, allowed)).toBeNull();
  });

  test("does not flag a normal estado de cuenta mail with a tienda link", () => {
    expect(
      suspiciousReason({
        subject: "Tu estado de cuenta está listo",
        text: "Puedes revisar el resumen de este mes en Tienda Plaza.",
        links: ["https://tiendaplaza.example/cuenta/octubre"],
      }, allowed),
    ).toBeNull();
  });

  test.each([
    "Banco Ficticio nunca te pedirá tu clave ni códigos por correo.",
    "No compartas tu clave con nadie.",
    "Protege tu clave y tu PIN.",
  ])("does not flag a security footer: %p", (text) => {
    expect(suspiciousReason({ subject: "Tu estado de cuenta de octubre", text, links: [] }, allowed)).toBeNull();
  });

  test("still flags a request hidden after a reassuring sentence", () => {
    expect(
      suspiciousReason({ subject: "Aviso", text: "Nunca bloqueamos sin aviso: ingresa tu clave para seguir.", links: [] }, allowed),
    ).not.toBeNull();
  });

  test.each([
    PDF_PASSWORD,
    "Para abrir el PDF adjunto, la clave son los primeros 4 dígitos de tu RUT.",
  ])("does not flag an allowed sender explaining how to open its file: %p", (text) => {
    expect(suspiciousReason({ subject: "Tu estado de cuenta", text, links: [] }, allowed)).toBeNull();
  });

  test.each([
    "Ingresa tu clave",
    "Ingresa tu RUT y tu clave",
    "Confirma tus datos",
    "Verifica tu cuenta",
    "Usa tu clave de internet para entrar a la sucursal",
    `${PDF_PASSWORD} Ingresa tu RUT aquí para continuar.`,
  ])("still flags a data request from an allowed sender: %p", (text) => {
    expect(suspiciousReason({ subject: "Tu estado de cuenta", text, links: [] }, allowed)).toBe(DATA_REQUEST);
  });

  test("flags the file explanation when the sender is not allowed", () => {
    expect(suspiciousReason({ subject: "Tu estado de cuenta", text: PDF_PASSWORD, links: [] }, { senderAllowed: false })).toBe(
      DATA_REQUEST,
    );
  });

  test.each([true, false])("flags a request for the RUT alone (sender allowed: %p)", (senderAllowed) => {
    expect(suspiciousReason({ subject: "Aviso", text: "Ingresa tu RUT para continuar", links: [] }, { senderAllowed })).toBe(
      DATA_REQUEST,
    );
  });
});
