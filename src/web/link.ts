/**
 * The link as a URL when it may be followed: `https:` on the default port, no
 * credentials, and a hostname that is one of `domains` or a subdomain of one.
 * Anything else, including a link that does not parse, is null.
 */
export function allowedLink(url: string, domains: readonly string[]): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  // URL drops the default port, so any port left here is a non-443 one.
  if (parsed.port !== "") return null;
  const host = parsed.hostname.toLowerCase();
  const allowed = domains.some((domain) => {
    const d = domain.toLowerCase();
    return d !== "" && (host === d || host.endsWith(`.${d}`));
  });
  return allowed ? parsed : null;
}
