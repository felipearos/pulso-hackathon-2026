import { createApp } from "./app";
import { realPorts } from "./real-ports";

const app = createApp(realPorts(), { demoOperatorKey: process.env.DEMO_OPERATOR_KEY });
const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({ hostname: process.env.HOST, port, fetch: app.handle });
console.log(`listening on ${server.url}`);

// One pass a minute: Gmail is read, the cita is set and sent. A pass still
// running when the next is due is not doubled; a pass that throws is logged and
// the next one runs anyway, since nobody watches the PC after the delivery.
const TICK_MS = 60_000;
let ticking = false;
const ticker = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await app.tick();
  } catch (error) {
    console.error(`tick failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    ticking = false;
  }
}, TICK_MS);

// systemd stops the app with SIGTERM on every deploy. Finishing in-flight
// requests first keeps a WhatsApp webhook from being cut mid-answer.
process.on("SIGTERM", async () => {
  clearInterval(ticker);
  await server.stop();
  process.exit(0);
});
