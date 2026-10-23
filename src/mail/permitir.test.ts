import { describe, expect, test } from "bun:test";
import { permitirUrl } from "./permitir";

describe("permitirUrl", () => {
  test("defaults to the Funnel URL", () => {
    expect(permitirUrl({})).toBe("https://desktop.taild8ed7e.ts.net/permitir");
  });

  test("uses PUBLIC_BASE_URL without its trailing slashes", () => {
    expect(permitirUrl({ PUBLIC_BASE_URL: "https://example.test//" })).toBe("https://example.test/permitir");
  });
});
