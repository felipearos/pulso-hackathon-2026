/**
 * Where Patricia's state lives. On the live PC `DATABASE_PATH` points outside
 * the checkout, so a redeploy keeps every night she has heard; locally it
 * falls back to a gitignored file next to the checkout.
 */
export function databasePath(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_PATH || "data/pulso.db";
}
