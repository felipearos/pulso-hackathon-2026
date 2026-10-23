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
 * The webhook's two Meta secrets. Either may be missing and the app still
 * starts and answers `/health` on the operator's PC: an unset secret only makes
 * the webhook refuse deliveries (401) and the challenge (403), which is what
 * lets the units come up before anyone has filled Doppler in.
 */
export function webhookConfig(env: Record<string, string | undefined> = process.env): WebhookConfig {
  return { appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN };
}
