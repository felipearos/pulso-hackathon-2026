import { createApp, type App } from "./app";
import { openDatabase } from "./db";
import type { Database } from "bun:sqlite";
import { FakeClock, FakeLlm, FakeMail, FakeVoice, FakeWhatsApp } from "./fakes";

/** Monday 19 October 2026, 09:00 in Santiago: the default start of a test. */
export const TEST_START = new Date("2026-10-19T09:00:00-03:00");

export type TestApp = {
  app: App;
  clock: FakeClock;
  mail: FakeMail;
  whatsapp: FakeWhatsApp;
  llm: FakeLlm;
  voice: FakeVoice;
  db: Database;
};

/**
 * The app on an in-memory SQLite base with a fake for every port, in one line:
 * `const { app, clock, mail, whatsapp } = createTestApp();`
 * Pass `db` to build it over an existing base, as a restart would.
 */
export function createTestApp(
  options: {
    now?: Date;
    llm?: ConstructorParameters<typeof FakeLlm>[0];
    voice?: ConstructorParameters<typeof FakeVoice>[0];
    db?: Database;
  } = {},
): TestApp {
  const ports = {
    clock: new FakeClock(options.now ?? TEST_START),
    mail: new FakeMail(),
    whatsapp: new FakeWhatsApp(),
    llm: new FakeLlm(options.llm ?? []),
    voice: new FakeVoice(options.voice),
    db: options.db ?? openDatabase(":memory:"),
  };
  return { app: createApp(ports), ...ports };
}
