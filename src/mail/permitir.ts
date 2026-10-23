import { MissingEnvError } from "../missing-env";
import type { Store } from "../patricia/store";
import type { Clock, Mail } from "../ports";

/*
 * Patricia's one «Permitir»: `/permitir` sends her to Google's read-only
 * consent page, and `/gmail/callback` is where Google sends her back. The
 * `state` each start issues is single-use and short-lived, so a callback this
 * server never started (a forged or replayed link) connects nothing. Who may
 * sign in at all is Google's call: the OAuth app stays in test mode with
 * Patricia's fictional Gmail as its only test user (#65), so a stranger who
 * opens the link cannot swap in their own mailbox.
 */

/** The welcome audio (#46) links Patricia here; keep the two in step. */
export const PERMITIR_PATH = "/permitir";
export const CALLBACK_PATH = "/gmail/callback";
/** The Tailscale Funnel URL the live app is published at. */
export const DEFAULT_PUBLIC_BASE_URL = "https://desktop.taild8ed7e.ts.net";

/** The full «Permitir» link: `PUBLIC_BASE_URL`, or the Funnel URL, plus the route. */
export function permitirUrl(env: Record<string, string | undefined> = process.env): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || DEFAULT_PUBLIC_BASE_URL;
  return `${base}${PERMITIR_PATH}`;
}

/** How long she has between opening the link and coming back from Google. */
const STATE_TTL_MS = 15 * 60 * 1000;

export type PermitirDeps = {
  mail: Mail;
  store: Store;
  /** Raw time source: only ages the `state`, which is real time, not the demo's. */
  clock: Clock;
};

export type Permitir = {
  /** Answers the two «Permitir» routes; null for any other request. */
  handle(request: Request): Promise<Response> | null;
};

export function createPermitir(deps: PermitirDeps): Permitir {
  const { mail, store, clock } = deps;
  const issued = new Map<string, number>();

  const forgetExpired = () => {
    const now = clock.now().getTime();
    for (const [state, at] of issued) if (now - at > STATE_TTL_MS) issued.delete(state);
  };

  const start = async (): Promise<Response> => {
    forgetExpired();
    const state = crypto.randomUUID();
    let url: string;
    try {
      url = mail.consentUrl(state);
    } catch (error) {
      if (error instanceof MissingEnvError) {
        console.error(`mail: «Permitir» unavailable: ${error.message}`);
        return page(503, "Todavía no puedo conectar tu correo. Avísale al equipo, no es nada que hayas hecho tú.");
      }
      throw error;
    }
    issued.set(state, clock.now().getTime());
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  };

  const callback = async (url: URL): Promise<Response> => {
    forgetExpired();
    const state = url.searchParams.get("state") ?? "";
    if (!issued.delete(state)) {
      return page(400, "Este link ya no sirve. Abre de nuevo el link que te mandó Luna.");
    }
    if (url.searchParams.get("error")) {
      // She said no on Google's page: nothing to store, and nothing to insist on.
      return page(200, "Está bien, no conecté nada. Si algún día quieres, el link sigue siendo el mismo.");
    }
    const code = url.searchParams.get("code");
    if (!code) return page(400, "Google no me devolvió el permiso. Abre de nuevo el link que te mandó Luna.");
    try {
      await mail.connect(code);
    } catch (error) {
      // The adapter's errors carry a status and Google's code, never a token.
      console.error(`mail: «Permitir» failed: ${error instanceof Error ? error.message : String(error)}`);
      return page(502, "No pude terminar de conectar tu correo. Prueba de nuevo en un rato con el mismo link.");
    }
    store.updatePatricia({ gmailPermitido: true });
    store.recordDecision({
      tipo: "permitir-correo",
      motivo: "Patricia dio su «Permitir»: Luna lee su Gmail, solo los remitentes de la lista y sin poder escribir",
      datos: {},
    });
    return page(200, "Listo. Desde ahora me entero sola de lo que te llega del banco y de la tienda. Puedes cerrar esta página.");
  };

  return {
    handle(request) {
      if (request.method !== "GET") return null;
      const url = new URL(request.url);
      if (url.pathname === PERMITIR_PATH) return start();
      if (url.pathname === CALLBACK_PATH) return callback(url);
      return null;
    },
  };
}

/** A small Spanish page for Patricia's phone. */
function page(status: number, message: string): Response {
  const html = `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Luna</title></head><body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; font-size: 1.2rem; line-height: 1.5"><p>${message}</p></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
