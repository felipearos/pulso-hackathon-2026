import { NIGHT_AUDIO_URL, isMomentId, snapshotAt, type MomentId } from "./demo/moments";
import type { NightAudioResult } from "./demo/night-audio";

export interface Deps {
  demoPage: Blob;
  nightAudio: Blob;
  sendNightAudio: () => Promise<NightAudioResult>;
}

const MOMENT_ROUTE = /^\/demo\/moments\/([a-z0-9-]+)$/;

export function createHandler(deps: Deps): (request: Request) => Promise<Response> {
  // The demo clock lives in memory until the real clock lands in SQLite, so a
  // restart (every deploy) sends the control room back to Monday 09:00.
  let moment: MomentId | "start" = "start";

  return async (request) => {
    const { pathname } = new URL(request.url);

    if (request.method === "GET") {
      if (pathname === "/health") return Response.json({ status: "ok" });
      if (pathname === "/demo") {
        return new Response(deps.demoPage, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/demo/state") return Response.json(snapshotAt(moment));
      if (pathname === NIGHT_AUDIO_URL) {
        return new Response(deps.nightAudio, { headers: { "Content-Type": "audio/ogg" } });
      }
    }

    if (request.method === "POST") {
      if (pathname === "/demo/reset") {
        moment = "start";
        return Response.json({ snapshot: snapshotAt(moment) });
      }
      const id = MOMENT_ROUTE.exec(pathname)?.[1];
      if (id && isMomentId(id)) {
        moment = id;
        const whatsapp = id === "monday-night" ? await deps.sendNightAudio() : undefined;
        return Response.json({ snapshot: snapshotAt(moment), whatsapp });
      }
    }

    return new Response("Not found", { status: 404 });
  };
}
