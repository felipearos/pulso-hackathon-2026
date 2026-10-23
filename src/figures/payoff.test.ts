import { describe, expect, test } from "bun:test";
import { addMonths, minimumPayment, payoff, type Payoff, type Statement } from "./payoff";

/**
 * Estado de cuenta 8 from the case. These figures were chosen so the engine
 * reproduces the case's «unos 59 meses y $451.000» and «unos 17 meses y
 * $162.700»; the fixtures (#24, #68) must use the same ones.
 */
const statementEight: Statement = {
  totalBilled: 650_000,
  monthlyRate: 0.031,
  minimumRule: { percent: 0.0645, floor: 10_500, roundTo: 100 },
  overdue: 0,
};

function ended(result: Payoff): { months: number; totalInterest: number; freeOn: string } {
  if (!result.ends) throw new Error(`expected the plan to end, got ${result.reason}`);
  return result;
}

function expectIntegers(result: Payoff): void {
  if (!result.ends) return;
  expect(Number.isInteger(result.months)).toBe(true);
  expect(Number.isInteger(result.totalInterest)).toBe(true);
}

describe("payoff for estado de cuenta 8", () => {
  const figures = payoff(statementEight, 50_000, "2026-10-24");

  test("first pago mínimo is 41.900", () => {
    expect(figures.firstMinimum).toBe(41_900);
    expect(minimumPayment(650_000, statementEight.minimumRule)).toBe(41_900);
  });

  test("only the pago mínimo takes 59 months and 450.865 in interest", () => {
    const only = ended(figures.onlyMinimum);
    expect(only.months).toBe(59);
    expect(only.totalInterest).toBe(450_865);
    expectIntegers(figures.onlyMinimum);
  });

  test("50.000 a month takes 17 months and 162.060 in interest, free on 2028-03-24", () => {
    const fixed = ended(figures.fixedPayment);
    expect(fixed.months).toBe(17);
    expect(fixed.totalInterest).toBe(162_060);
    expect(fixed.freeOn).toBe("2028-03-24");
    expectIntegers(figures.fixedPayment);
  });

  test("versus the pago mínimo saves 42 months and 288.805 in interest", () => {
    expect(figures.versusMinimum).toEqual({ comparable: true, monthsSaved: 42, interestSaved: 288_805 });
  });
});

describe("payoff edge cases", () => {
  test.each([
    {
      name: "minimum zero never ends",
      statement: { ...statementEight, minimumRule: { percent: 0, floor: 0, roundTo: 100 } },
      payment: 50_000,
      fixed: { ends: true, months: 17, totalInterest: 162_060, freeOn: "2028-03-24" },
      onlyMinimum: { ends: false, reason: "zero-payment" },
    },
    {
      name: "rate zero",
      statement: { ...statementEight, monthlyRate: 0 },
      payment: 50_000,
      fixed: { ends: true, months: 13, totalInterest: 0, freeOn: "2027-11-24" },
      onlyMinimum: undefined,
    },
    {
      name: "payment below interest never ends",
      statement: statementEight,
      payment: 10_000,
      fixed: { ends: false, reason: "payment-below-interest" },
      onlyMinimum: undefined,
    },
    {
      name: "payment larger than the balance",
      statement: statementEight,
      payment: 1_000_000,
      fixed: { ends: true, months: 1, totalInterest: 0, freeOn: "2026-11-24" },
      onlyMinimum: undefined,
    },
  ])("$name", ({ statement, payment, fixed, onlyMinimum }) => {
    const figures = payoff(statement, payment, "2026-10-24");
    expect(figures.fixedPayment).toEqual(fixed as Payoff);
    expectIntegers(figures.fixedPayment);
    if (onlyMinimum) expect(figures.onlyMinimum).toEqual(onlyMinimum as Payoff);
    expectIntegers(figures.onlyMinimum);
    expect(Number.isInteger(figures.firstMinimum)).toBe(true);
  });

  test("minimum zero makes versus the pago mínimo explicit", () => {
    const figures = payoff(
      { ...statementEight, minimumRule: { percent: 0, floor: 0, roundTo: 100 } },
      50_000,
      "2026-10-24",
    );
    expect(figures.versusMinimum).toEqual({ comparable: false, reason: "minimum-never-ends" });
  });

  test("mora is added to the first pago mínimo and lengthens the payoff", () => {
    const withoutMora = ended(payoff(statementEight, 50_000, "2026-10-24").fixedPayment);
    const figures = payoff({ ...statementEight, overdue: 80_000 }, 50_000, "2026-10-24");
    expect(figures.firstMinimum).toBe(41_900 + 80_000);
    const withMora = ended(figures.fixedPayment);
    expect(withMora.months).toBeGreaterThan(withoutMora.months);
    expect(withMora.totalInterest).toBeGreaterThan(withoutMora.totalInterest);
    expectIntegers(figures.fixedPayment);
    expectIntegers(figures.onlyMinimum);
  });
});

describe("addMonths", () => {
  test.each([
    { from: "2026-10-24", months: 17, expected: "2028-03-24" },
    { from: "2026-01-31", months: 1, expected: "2026-02-28" },
    { from: "2027-12-31", months: 2, expected: "2028-02-29" },
    { from: "2026-08-31", months: 1, expected: "2026-09-30" },
    { from: "2026-10-24", months: 0, expected: "2026-10-24" },
  ])("$from plus $months months is $expected", ({ from, months, expected }) => {
    expect(addMonths(from, months)).toBe(expected);
  });

  test("freeOn clamps to the month's last day", () => {
    const fixed = ended(payoff(statementEight, 1_000_000, "2026-01-31").fixedPayment);
    expect(fixed.freeOn).toBe("2026-02-28");
  });
});
