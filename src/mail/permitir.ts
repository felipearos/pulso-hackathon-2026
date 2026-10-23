/** The «Permitir» link: where Patricia gives Luna read-only access to her mail. */

/** The OAuth start route; ticket #27 serves it. */
export const PERMITIR_PATH = "/permitir";
/** The Tailscale Funnel URL the live app is published at. */
export const DEFAULT_PUBLIC_BASE_URL = "https://desktop.taild8ed7e.ts.net";

/** The full «Permitir» link: `PUBLIC_BASE_URL`, or the Funnel URL, plus the route. */
export function permitirUrl(env: Record<string, string | undefined> = process.env): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || DEFAULT_PUBLIC_BASE_URL;
  return `${base}${PERMITIR_PATH}`;
}
