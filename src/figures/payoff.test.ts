import { describe, expect, test } from "bun:test";
import { addMonths, minimumPayment, payoff, type Payoff, type Statement } from "./payoff";

/**
 * Estado de cuenta 8 from the case. These figures were chosen so the engine
 * reproduces the figures in issue #29, «unos 59 meses y $451.000» and «unos
 * 17 meses y $162.700», until the real fixtures exist.
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

interface EdgeCase {
  name: string;
  statement: Statement;
  payment: number;
  firstMinimum: number;
  fixed: Payoff;
  onlyMinimum: Payoff;
}

const neverEndsOnMinimum: Payoff = { ends: false, reason: "zero-payment" };
const eightOnMinimum: Payoff = { ends: true, months: 59, totalInterest: 450_865, freeOn: "2031-09-24" };

const edgeCases: EdgeCase[] = [
  {
    name: "minimum zero never ends",
    statement: { ...statementEight, minimumRule: { percent: 0, floor: 0, roundTo: 100 } },
    payment: 50_000,
    firstMinimum: 0,
    fixed: { ends: true, months: 17, totalInterest: 162_060, freeOn: "2028-03-24" },
    onlyMinimum: neverEndsOnMinimum,
  },
  {
    name: "rate zero",
    statement: { ...statementEight, monthlyRate: 0 },
    payment: 50_000,
    firstMinimum: 41_900,
    fixed: { ends: true, months: 13, totalInterest: 0, freeOn: "2027-11-24" },
    onlyMinimum: { ends: true, months: 37, totalInterest: 0, freeOn: "2029-11-24" },
  },
  {
    name: "mora is added to the balance and to the first pago mínimo",
    statement: { ...statementEight, overdue: 80_000 },
    payment: 50_000,
    firstMinimum: 121_900,
    fixed: { ends: true, months: 19, totalInterest: 216_713, freeOn: "2028-05-24" },
    onlyMinimum: eightOnMinimum,
  },
  {
    name: "payment below interest never ends",
    statement: statementEight,
    payment: 10_000,
    firstMinimum: 41_900,
    fixed: { ends: false, reason: "payment-below-interest" },
    onlyMinimum: eightOnMinimum,
  },
  {
    name: "payment larger than the balance",
    statement: statementEight,
    payment: 1_000_000,
    firstMinimum: 41_900,
    fixed: { ends: true, months: 1, totalInterest: 0, freeOn: "2026-11-24" },
    onlyMinimum: eightOnMinimum,
  },
  {
    name: "zero balance is already free",
    statement: { ...statementEight, totalBilled: 0 },
    payment: 50_000,
    firstMinimum: 0,
    fixed: { ends: true, months: 0, totalInterest: 0, freeOn: "2026-10-24" },
    onlyMinimum: { ends: true, months: 0, totalInterest: 0, freeOn: "2026-10-24" },
  },
];

describe("payoff edge cases", () => {
  test.each(edgeCases)("$name", ({ statement, payment, firstMinimum, fixed, onlyMinimum }) => {
    const figures = payoff(statement, payment, "2026-10-24");
    expect(figures.firstMinimum).toBe(firstMinimum);
    expect(figures.fixedPayment).toEqual(fixed);
    expect(figures.onlyMinimum).toEqual(onlyMinimum);
    expectIntegers(figures.fixedPayment);
    expectIntegers(figures.onlyMinimum);
  });

  test("minimum zero makes versus the pago mínimo explicit", () => {
    const figures = payoff(
      { ...statementEight, minimumRule: { percent: 0, floor: 0, roundTo: 100 } },
      50_000,
      "2026-10-24",
    );
    expect(figures.versusMinimum).toEqual({ comparable: false, reason: "minimum-never-ends" });
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
