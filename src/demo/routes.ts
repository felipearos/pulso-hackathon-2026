import { createHash, timingSafeEqual } from "node:crypto";
import type { DemoClock } from "../clock/demo-clock";
import type { Store } from "../patricia/store";
import { findMomento, type MomentoDelGuion } from "./guion";

/** What the control room drives: the same flows Patricia's night runs on, no logic of its own. */
export type DemoDeps = {
  /** The operator token; unset or empty turns /sala off entirely. */
  token: string | undefined;
  clock: DemoClock;
  store: Store;
  tick(): Promise<void>;
  reset(): void;
  guion: readonly MomentoDelGuion[];
  /** The control room page, served as is. */
  page: string;
};

const NOT_FOUND = () => new Response("Not found", { status: 404 });

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Compares in constant time; hashing first gives both sides the same length. */
function tokenMatches(expected: string, given: string | null): boolean {
  return given !== null && timingSafeEqual(digest(expected), digest(given));
}

/** The operator's token: the `x-demo-token` header (the page's calls) or else `?token=` (the projector's URL). */
function givenToken(request: Request, url: URL): string | null {
  return request.headers.get("x-demo-token") || url.searchParams.get("token");
}

/**
 * The /sala control room routes. Returns null for any other path so the app
 * falls through to its own routes. Without the right token every /sala path
 * answers 404, the same as a path that does not exist, because the app is
 * published on the internet.
 */
export function createDemoRoutes(deps: DemoDeps): (request: Request) => Promise<Response | null> {
  const state = () => {
    const now = deps.clock.now();
    return {
      now: now.toISOString(),
      relojReal: deps.clock.isReal(),
      etapa: deps.store.getPatricia().etapa,
      guion: deps.guion.map(({ id, label, at }) => ({ id, label, at: at.toISOString() })),
      citas: deps.store.citas().slice(-5),
      decisiones: deps.store
        .decisions()
        .slice(-10)
        .map(({ at, tipo, motivo }) => ({ at: at.toISOString(), tipo, motivo })),
    };
  };
  const run = async (step: () => void | Promise<void>): Promise<Response> => {
    try {
      await step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`demo: ${message}`);
      let current = {};
      try {
        current = state();
      } catch {
        // The store itself may be what failed; the error alone still reaches the page.
      }
      return Response.json({ error: message, ...current }, { status: 500 });
    }
    return Response.json(state());
  };

  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname !== "/sala" && !pathname.startsWith("/sala/")) return null;
    if (!deps.token || !tokenMatches(deps.token, givenToken(request, url))) return NOT_FOUND();

    if (request.method === "GET" && pathname === "/sala") {
      return new Response(deps.page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (request.method === "GET" && pathname === "/sala/state") return Response.json(state());
    if (request.method === "POST" && pathname === "/sala/tick") return run(deps.tick);
    if (request.method === "POST" && pathname === "/sala/reset") return run(deps.reset);
    const match = /^\/sala\/momentos\/([^/]+)$/.exec(pathname);
    if (request.method === "POST" && match) {
      let id: string;
      try {
        id = decodeURIComponent(match[1]!);
      } catch {
        return Response.json({ error: `no momento ${match[1]}` }, { status: 400 });
      }
      const momento = findMomento(deps.guion, id);
      if (!momento) return Response.json({ error: `no momento ${id}` }, { status: 400 });
      // Jump, then tick at once, so the button shows what that moment brings.
      return run(async () => {
        deps.clock.set(momento.at);
        await deps.tick();
      });
    }
    return NOT_FOUND();
  };
}
