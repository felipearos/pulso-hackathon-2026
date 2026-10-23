import { describe, expect, test } from "bun:test";
import { handle } from "./server";

describe("handle", () => {
  test("reports health", async () => {
    const response = handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("answers 404 for unknown paths", () => {
    const response = handle(new Request("http://localhost/nope"));
    expect(response.status).toBe(404);
  });
});
