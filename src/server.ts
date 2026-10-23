/**
 * The HTTP entry point. The host checks `/health` to know the process is up,
 * which matters because nobody may touch the deployment after the 13:00
 * delivery.
 */
export function handle(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  return new Response("Not found", { status: 404 });
}
