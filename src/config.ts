import type { WebhookConfig } from "./whatsapp/webhook";

/**
 * Where Patricia's state lives. On the live PC `DATABASE_PATH` points outside
 * the checkout, so a redeploy keeps every night she has heard; locally it
 * falls back to a gitignored file next to the checkout.
 */
export function databasePath(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_PATH || "data/pulso.db";
}

/**
 * The webhook's two Meta secrets. Both are read lazily, like the real ports'
 * variables: the app has to start and answer `/health` on the operator's PC
 * before anyone has set them.
 */
export function webhookConfig(env: Record<string, string | undefined> = process.env): WebhookConfig {
  return { appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN };
}
