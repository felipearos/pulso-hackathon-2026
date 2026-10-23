import { nightAudioSender } from "./demo/night-audio";
import { createHandler } from "./server";

const nightAudio = Bun.file(new URL("../assets/night-audio-test.ogg", import.meta.url));
const handle = createHandler({
  demoPage: Bun.file(new URL("./demo/page.html", import.meta.url)),
  nightAudio,
  sendNightAudio: nightAudioSender(process.env, nightAudio),
});

const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({ hostname: process.env.HOST, port, fetch: handle });
console.log(`listening on ${server.url}`);

// systemd stops the app with SIGTERM on every deploy. Finishing in-flight
// requests first keeps a WhatsApp webhook from being cut mid-answer.
process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
