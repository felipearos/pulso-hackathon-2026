/**
 * Where Patricia's state lives. In Railway `DATABASE_PATH` points into the
 * volume at /data, so a redeploy keeps every night she has heard; locally it
 * falls back to a gitignored file next to the checkout.
 */
export function databasePath(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_PATH || "data/pulso.db";
}
