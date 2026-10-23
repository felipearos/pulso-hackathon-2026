import { createApp, type App } from "./app";
import { openDatabase } from "./db";
import { FakeClock, FakeLlm, FakeMail, FakeVoice, FakeWhatsApp } from "./fakes";

/** Monday 20 October 2026, 09:00 in Santiago: the default start of a test. */
export const TEST_START = new Date("2026-10-20T09:00:00-03:00");

export type TestApp = {
  app: App;
  clock: FakeClock;
  mail: FakeMail;
  whatsapp: FakeWhatsApp;
  llm: FakeLlm;
  voice: FakeVoice;
  db: ReturnType<typeof openDatabase>;
};

/**
 * The app on an in-memory SQLite base with a fake for every port, in one line:
 * `const { app, clock, mail, whatsapp } = createTestApp();`
 */
export function createTestApp(
  options: { now?: Date; llm?: ConstructorParameters<typeof FakeLlm>[0] } = {},
): TestApp {
  const ports = {
    clock: new FakeClock(options.now ?? TEST_START),
    mail: new FakeMail(),
    whatsapp: new FakeWhatsApp(),
    llm: new FakeLlm(options.llm ?? []),
    voice: new FakeVoice(),
    db: openDatabase(":memory:"),
  };
  return { app: createApp(ports), ...ports };
}
