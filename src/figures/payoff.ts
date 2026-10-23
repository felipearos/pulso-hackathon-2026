/** How a bank computes the pago mínimo from a cycle's balance. */
export interface MinimumRule {
  /** Fraction of the balance, e.g. 0.0645. */
  percent: number;
  /** Lowest pago mínimo in pesos. */
  floor: number;
  /** Rounding step in pesos, e.g. 100; 0 or 1 rounds to the whole peso. */
  roundTo: number;
}

/** The figures of an estado de cuenta that the payoff engine needs. */
export interface Statement {
  /** Total facturado in integer pesos, already including this cycle's interest. */
  totalBilled: number;
  /** Monthly interest rate as a fraction, e.g. 0.031. */
  monthlyRate: number;
  minimumRule: MinimumRule;
  /** Pesos in mora, added to the balance and to the first pago mínimo. */
  overdue?: number;
}

/** Why a way of paying never reaches a zero balance. */
export type NeverEndsReason = "zero-payment" | "payment-below-interest" | "over-cap";

/** Outcome of paying a balance off one way: it ends on a date, or it never ends. */
export type Payoff =
  | { ends: true; months: number; totalInterest: number; freeOn: string }
  | { ends: false; reason: NeverEndsReason };

/** Difference between paying a fixed amount and paying only the pago mínimo. */
export type VersusMinimum =
  | { comparable: true; monthsSaved: number; interestSaved: number }
  | { comparable: false; reason: "minimum-never-ends" | "payment-never-ends" };

/** Everything the payoff engine says about one estado de cuenta and one monthly payment. */
export interface PayoffFigures {
  fixedPayment: Payoff;
  onlyMinimum: Payoff;
  firstMinimum: number;
  versusMinimum: VersusMinimum;
}

/** Longest simulation in cycles before a plan is declared never-ending. */
export const MAX_CYCLES = 1200;

/** Pago mínimo the rule asks for on a balance, never more than the balance. */
export function minimumPayment(balance: number, rule: MinimumRule): number {
  const raw = balance * rule.percent;
  const rounded = rule.roundTo > 1 ? Math.round(raw / rule.roundTo) * rule.roundTo : Math.round(raw);
  return Math.min(balance, Math.max(rule.floor, rounded));
}

/** Calendar date `months` after an ISO `YYYY-MM-DD` date, day clamped to the month's end. */
export function addMonths(from: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!match) throw new Error(`Invalid ISO date: ${from}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  const lastDay = m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  const d = Math.min(day, lastDay);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function simulate(
  statement: Statement,
  paymentFor: (balance: number, cycle: number) => number,
  from: string,
): Payoff {
  let balance = statement.totalBilled + (statement.overdue ?? 0);
  let months = 0;
  let totalInterest = 0;
  while (months < MAX_CYCLES) {
    const payment = Math.min(balance, paymentFor(balance, months + 1));
    if (payment <= 0 && balance > 0) return { ends: false, reason: "zero-payment" };
    const before = balance;
    balance -= payment;
    months += 1;
    if (balance <= 0) return { ends: true, months, totalInterest, freeOn: addMonths(from, months) };
    const interest = Math.round(balance * statement.monthlyRate);
    totalInterest += interest;
    balance += interest;
    if (balance >= before) return { ends: false, reason: "payment-below-interest" };
  }
  return { ends: false, reason: "over-cap" };
}

/** Pays an estado de cuenta off with a fixed monthly payment and with only the pago mínimo, from an ISO date. */
export function payoff(statement: Statement, monthlyPayment: number, from: string): PayoffFigures {
  const overdue = statement.overdue ?? 0;
  const balance = statement.totalBilled + overdue;
  const firstMinimum = Math.min(balance, minimumPayment(statement.totalBilled, statement.minimumRule) + overdue);
  const fixedPayment = simulate(statement, () => monthlyPayment, from);
  const onlyMinimum = simulate(
    statement,
    (b, cycle) => (cycle === 1 ? firstMinimum : minimumPayment(b, statement.minimumRule)),
    from,
  );
  let versusMinimum: VersusMinimum;
  if (!onlyMinimum.ends) versusMinimum = { comparable: false, reason: "minimum-never-ends" };
  else if (!fixedPayment.ends) versusMinimum = { comparable: false, reason: "payment-never-ends" };
  else
    versusMinimum = {
      comparable: true,
      monthsSaved: onlyMinimum.months - fixedPayment.months,
      interestSaved: onlyMinimum.totalInterest - fixedPayment.totalInterest,
    };
  return { fixedPayment, onlyMinimum, firstMinimum, versusMinimum };
}
