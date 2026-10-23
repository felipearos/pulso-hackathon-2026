import { describe, expect, test } from "bun:test";
import { voiceIdFor, vozDe } from "./voces";

describe("vozDe", () => {
  test("otra is the other voice", () => {
    expect(vozDe("otra")).toBe("otra");
  });

  test("null or an unknown value is the principal voice", () => {
    expect(vozDe(null)).toBe("principal");
    expect(vozDe("principal")).toBe("principal");
    expect(vozDe("robot")).toBe("principal");
  });
});

describe("voiceIdFor", () => {
  const env = { ELEVENLABS_VOICE_ID: "principal-id", ELEVENLABS_VOICE_ID_OTRA: "otra-id" };

  test("principal uses ELEVENLABS_VOICE_ID", () => {
    expect(voiceIdFor("principal", env)).toBe("principal-id");
  });

  test("otra uses ELEVENLABS_VOICE_ID_OTRA", () => {
    expect(voiceIdFor("otra", env)).toBe("otra-id");
  });

  test("otra falls back to ELEVENLABS_VOICE_ID when the other id is unset or empty", () => {
    expect(voiceIdFor("otra", { ELEVENLABS_VOICE_ID: "principal-id" })).toBe("principal-id");
    expect(voiceIdFor("otra", { ELEVENLABS_VOICE_ID: "principal-id", ELEVENLABS_VOICE_ID_OTRA: "" })).toBe("principal-id");
  });

  test("is undefined when no id is set", () => {
    expect(voiceIdFor("principal", {})).toBeUndefined();
  });
});
