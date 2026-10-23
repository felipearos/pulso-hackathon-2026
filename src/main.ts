import { handle } from "./server";

const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({ port, fetch: handle });
console.log(`listening on ${server.url}`);

// Railway stops the old container with SIGTERM on every deploy. Finishing
// in-flight requests first keeps a WhatsApp webhook from being cut mid-answer.
process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
