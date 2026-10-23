import { createApp } from "./app";
import { realPorts } from "./real-ports";

const app = createApp(realPorts());
const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({ hostname: process.env.HOST, port, fetch: app.handle });
console.log(`listening on ${server.url}`);

// systemd stops the app with SIGTERM on every deploy. Finishing in-flight
// requests first keeps a WhatsApp webhook from being cut mid-answer.
process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
