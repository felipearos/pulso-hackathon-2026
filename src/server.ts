import { timingSafeEqual } from "node:crypto";
import { NIGHT_AUDIO_URL, isMomentId, snapshotAt, type MomentId } from "./demo/moments";
import type { NightAudioResult } from "./demo/night-audio";
import type { Webhook } from "./whatsapp/webhook";

export interface Deps {
  demoPage: Blob;
  /** Luna's front door, served on `/`. */
  landingPage: Blob;
  /** Stands in for `/empezar` and `/entrar` until sign-up and sign-in exist. */
  soonPage: Blob;
  nightAudio: Blob;
  sendNightAudio: () => Promise<NightAudioResult>;
  /** The operator's key for the routes that move the clock; unset leaves the room view-only. */
  operatorKey: string | undefined;
  /** Meta's webhook, answered on `/webhook/whatsapp`. */
  webhook: Webhook;
}

/** Where Meta is subscribed; the app answers both its challenge and its deliveries there. */
const WEBHOOK_PATH = "/webhook/whatsapp";

/** The header the control room sends its operator key in. */
export const OPERATOR_KEY_HEADER = "x-demo-key";

/** The routes the landing links to, answered with the coming-soon page for now. */
const SOON_PATHS = new Set(["/empezar", "/entrar"]);

const HTML = { "Content-Type": "text/html; charset=utf-8" };

const MOMENT_ROUTE = /^\/demo\/moments\/([a-z0-9-]+)$/;

function sameKey(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHandler(deps: Deps): (request: Request) => Promise<Response> {
  // The demo clock lives in memory until the real clock lands in SQLite, so a
  // restart (every deploy) sends the control room back to Monday 09:00.
  let moment: MomentId | "start" = "start";

  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;

    // Meta first: its challenge and its deliveries carry no operator key.
    if (pathname === WEBHOOK_PATH) {
      if (request.method === "GET") return deps.webhook.verify(url);
      if (request.method === "POST") return deps.webhook.receive(request);
    }

    if (request.method === "GET") {
      if (pathname === "/health") return Response.json({ status: "ok" });
      if (pathname === "/") return new Response(deps.landingPage, { headers: HTML });
      if (SOON_PATHS.has(pathname)) return new Response(deps.soonPage, { headers: HTML });
      if (pathname === "/demo") return new Response(deps.demoPage, { headers: HTML });
      if (pathname === "/demo/state") return Response.json(snapshotAt(moment));
      if (pathname === NIGHT_AUDIO_URL) {
        return new Response(deps.nightAudio, { headers: { "Content-Type": "audio/ogg" } });
      }
    }

    if (request.method === "POST" && pathname.startsWith("/demo/")) {
      // The public URL reaches these routes, so moving the clock, and with it
      // sending audio to Patricia's phone, takes the operator's key.
      if (!deps.operatorKey) {
        return Response.json({ error: "falta DEMO_OPERATOR_KEY en Doppler: la sala solo se mira" }, { status: 503 });
      }
      if (!sameKey(request.headers.get(OPERATOR_KEY_HEADER), deps.operatorKey)) {
        return Response.json({ error: "falta la clave de operador: abre /demo?clave=…" }, { status: 401 });
      }

      if (pathname === "/demo/reset") {
        moment = "start";
        return Response.json({ snapshot: snapshotAt(moment) });
      }
      const id = MOMENT_ROUTE.exec(pathname)?.[1];
      if (id && isMomentId(id)) {
        // Only arriving at Monday night sends the audio: pressing it again
        // while there does not send a second one.
        const arriving = id === "monday-night" && moment !== "monday-night";
        moment = id;
        const whatsapp = arriving ? await deps.sendNightAudio() : undefined;
        return Response.json({ snapshot: snapshotAt(moment), whatsapp });
      }
    }

    return new Response("Not found", { status: 404 });
  };
}
