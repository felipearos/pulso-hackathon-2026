import { describe, expect, test } from "bun:test";
import { MOMENT_IDS, snapshotAt } from "./moments";

describe("snapshotAt", () => {
  test("shows nothing before the statement arrives", () => {
    const start = snapshotAt("start");
    expect(start.stepsDone).toBe(0);
    expect(start.figures).toEqual([]);
    expect(start.now.every((row) => !row.lit)).toBe(true);
  });

  test("Luna stays silent when the statement arrives in the morning", () => {
    const morning = snapshotAt("monday-email");
    expect(morning.messages).toEqual([]);
    expect(morning.figures.find((f) => f.label === "Pago mínimo")?.value).toBe("$41.900");
  });

  test("the first night audio starts with the good news and one figure", () => {
    const night = snapshotAt("monday-night");
    const [audio] = night.messages;
    expect(audio?.kind).toBe("voice");
    expect(audio?.text).toContain("siete meses pagando siempre a tiempo");
    expect(audio?.text).toContain("cuarenta y un mil novecientos");
    expect(night.before.find((row) => row.day === "Lun")?.crossed).toBe(true);
  });

  test("Thursday proposes the minimum plus what she set aside", () => {
    const thursday = snapshotAt("thursday-night");
    const values = thursday.figures.map((f) => f.value);
    expect(values).toContain("$8.100");
    expect(values).toContain("$50.000 → libre en 17 meses");
    expect(thursday.metrics.aboveMinimum).toBe("1 de 1");
  });

  test("the early-morning answer carries no figures", () => {
    const reply = snapshotAt("sunday-early").messages.at(-1);
    expect(reply?.from).toBe("luna");
    expect(reply?.text).not.toMatch(/\d|\$/);
  });

  test("the nights counter matches the PRD at week 4 and at the close", () => {
    expect(snapshotAt("week-4").nights).toEqual({ invited: 6, listened: 5, noPressure: 1 });
    expect(snapshotAt("week-5").nights).toEqual({ invited: 9, listened: 7, noPressure: 2 });
  });

  test("each moment keeps what the previous ones left on screen", () => {
    const counts = MOMENT_IDS.map((id) => snapshotAt(id).messages.length);
    counts.slice(1).forEach((count, i) => expect(count).toBeGreaterThanOrEqual(counts[i] ?? 0));
    const close = snapshotAt("week-5");
    expect(close.stepsDone).toBe(5);
    expect(close.now.every((row) => row.lit)).toBe(true);
  });
});
