import { createApp, type App } from "./app";
import { openDatabase } from "./db";
import type { Database } from "bun:sqlite";
import { FakeClock, FakeLlm, FakeMail, FakeVoice, FakeWeb, FakeWhatsApp } from "./fakes";
import type { WebhookConfig } from "./whatsapp/webhook";

/** Monday 19 October 2026, 09:00 in Santiago: the default start of a test. */
export const TEST_START = new Date("2026-10-19T09:00:00-03:00");

/** The webhook secrets a test runs with; fictional, like every fixture. */
export const TEST_WEBHOOK_CONFIG = { appSecret: "secreto-de-prueba", verifyToken: "token-de-prueba" };

export type TestApp = {
  app: App;
  clock: FakeClock;
  mail: FakeMail;
  whatsapp: FakeWhatsApp;
  llm: FakeLlm;
  voice: FakeVoice;
  web: FakeWeb;
  db: Database;
};

/**
 * The app on an in-memory SQLite base with a fake for every port, in one line:
 * `const { app, clock, mail, whatsapp } = createTestApp();`
 * Pass `db` to build it over an existing base, as a restart would, and
 * `demoOperatorKey` to drive the control room. The webhook runs with
 * `TEST_WEBHOOK_CONFIG` unless `webhook` says otherwise, so a test can post a
 * signed delivery without configuring anything.
 */
export function createTestApp(
  options: {
    now?: Date;
    llm?: ConstructorParameters<typeof FakeLlm>[0];
    voice?: ConstructorParameters<typeof FakeVoice>[0];
    web?: ConstructorParameters<typeof FakeWeb>[0];
    db?: Database;
    demoOperatorKey?: string;
    demoToken?: string;
    webhook?: WebhookConfig;
    simulador?: boolean;
    entradaPhone?: string;
    publicBaseUrl?: string;
    gmailLoginHint?: boolean;
  } = {},
): TestApp {
  const ports = {
    clock: new FakeClock(options.now ?? TEST_START),
    mail: new FakeMail(),
    whatsapp: new FakeWhatsApp(),
    llm: new FakeLlm(options.llm ?? []),
    voice: new FakeVoice(options.voice),
    web: new FakeWeb(options.web ?? {}),
    db: options.db ?? openDatabase(":memory:"),
  };
  const app = createApp(ports, {
    demoOperatorKey: options.demoOperatorKey,
    demoToken: options.demoToken,
    webhook: options.webhook ?? TEST_WEBHOOK_CONFIG,
    simulador: options.simulador,
    entradaPhone: options.entradaPhone,
    publicBaseUrl: options.publicBaseUrl,
    gmailLoginHint: options.gmailLoginHint,
  });
  return { app, ...ports };
}
