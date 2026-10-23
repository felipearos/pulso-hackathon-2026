import { handle } from "./server";

const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({ port, fetch: handle });
console.log(`listening on ${server.url}`);
