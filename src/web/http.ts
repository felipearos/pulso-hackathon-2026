import type { Web, WebDocument } from "../ports";
import type { Fetch } from "../voice/elevenlabs";
import { allowedLink } from "./link";

const MAX_REDIRECTS = 3;

/**
 * The web port over HTTP. Every hop, the first URL and each redirect, must be
 * an allowed link; redirects are followed by hand so one out of the domains
 * is refused instead of fetched.
 */
export function createHttpWeb(options: { fetch?: Fetch; timeoutMs?: number; maxBytes?: number } = {}): Web {
  const fetchDocument = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;

  return {
    async fetchDocument(url: string, domains: readonly string[]): Promise<WebDocument> {
      let current = allowedLink(url, domains);
      if (!current) throw new Error(`web: refused link outside the allowed domains: ${url}`);

      for (let redirects = 0; ; redirects++) {
        const response = await fetchDocument(current.href, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error(`web: redirect ${response.status} without a location from ${current.href}`);
          if (redirects >= MAX_REDIRECTS) throw new Error(`web: more than ${MAX_REDIRECTS} redirects from ${url}`);
          let target: string;
          try {
            target = new URL(location, current).href;
          } catch {
            throw new Error(`web: redirect to an invalid location from ${current.href}`);
          }
          const next = allowedLink(target, domains);
          if (!next) throw new Error(`web: refused redirect outside the allowed domains: ${target}`);
          current = next;
          continue;
        }

        if (!response.ok) throw new Error(`web: ${current.href} answered ${response.status}`);

        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) {
          throw new Error(`web: ${current.href} is ${declared} bytes, over the ${maxBytes} limit`);
        }
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength > maxBytes) {
          throw new Error(`web: ${current.href} is ${body.byteLength} bytes, over the ${maxBytes} limit`);
        }
        return { contentType: response.headers.get("content-type") ?? "", body };
      }
    },
  };
}
