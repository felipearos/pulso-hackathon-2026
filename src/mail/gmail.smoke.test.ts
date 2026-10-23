import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { databasePath } from "../config";
import { migrate, openDatabase } from "../db";
import { systemClock } from "../real-ports";
import { createGmailMail } from "./gmail";
import { createGmailAccount } from "./gmail-oauth";
import { allowedSenderDomains } from "./senders";

/*
 * Reads the real Gmail, so it runs only on request: GMAIL_SMOKE=1 with the
 * OAuth variables, against a base where Patricia already gave her «Permitir»
 * (open /gmail/permitir on a running app first). The token is copied into an
 * in-memory base, so the real base's cursor does not move.
 */
const env = process.env;
const ready =
  env.GMAIL_SMOKE === "1" && Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REDIRECT_URI);

test.skipIf(!ready)(
  "lists the allowed senders' mail from the connected Gmail",
  async () => {
    const source = openDatabase(databasePath(env));
    migrate(source);
    const row = source.query("SELECT * FROM gmail_cuenta WHERE id = 1").get() as Record<string, unknown> | null;
    source.close();
    if (!row) throw new Error("no Gmail account in the base: open /gmail/permitir on the running app first");

    const db = new Database(":memory:", { strict: true });
    migrate(db);
    db.run(
      `INSERT INTO gmail_cuenta (id, refresh_token, access_token, access_expires_at, cursor_ms, cursor_ids, conectada_at)
       VALUES (1, ?, NULL, NULL, ?, '[]', ?)`,
      [row.refresh_token as string, Date.now() - 7 * 24 * 60 * 60 * 1000, new Date().toISOString()],
    );
    const account = createGmailAccount({ db, env, clock: systemClock });
    const mails = await createGmailMail({ account }).fetchNew(allowedSenderDomains());

    expect(Array.isArray(mails)).toBe(true);
    for (const mail of mails) {
      expect(mail.id).not.toBe("");
      expect(mail.receivedAt).toBeInstanceOf(Date);
    }
    console.log(`gmail smoke: ${mails.length} mail(s) from the allowed senders in the last 7 days`);
  },
  30_000,
);
