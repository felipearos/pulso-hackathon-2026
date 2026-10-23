import { parseSantiago } from "../clock/santiago";
import guion from "./guion.json";

/** A named point of the guion the control room can jump the demo clock to. */
export type MomentoDelGuion = { id: string; label: string; at: Date };

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validates the guion read from configuration: a non-empty array of entries
 * with a unique kebab-case `id`, a `label` and an `at` in Santiago wall time.
 * Throws naming the offending entry.
 */
export function parseGuion(raw: unknown): MomentoDelGuion[] {
  if (!Array.isArray(raw)) throw new Error("guion must be an array of momentos");
  if (raw.length === 0) throw new Error("guion must hold at least one momento");
  const seen = new Set<string>();
  return raw.map((entry: unknown, index) => {
    const where = `guion entry ${index} (${JSON.stringify(entry)})`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where} is not an object`);
    const { id, label, at } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error(`${where} needs a lowercase kebab-case id`);
    if (typeof label !== "string" || label.trim() === "") throw new Error(`${where} needs a non-empty label`);
    if (typeof at !== "string") throw new Error(`${where} needs an at in Santiago wall time`);
    if (seen.has(id)) throw new Error(`${where} repeats the id ${id}`);
    seen.add(id);
    let instant: Date;
    try {
      instant = parseSantiago(at);
    } catch (error) {
      throw new RangeError(`${where}: ${(error as Error).message}`);
    }
    return { id, label, at: instant };
  });
}

/** The guion shipped in `guion.json`, validated at load. */
export const GUION: MomentoDelGuion[] = parseGuion(guion);

/** The momento with `id`, or null when the guion has none. */
export function findMomento(guion: readonly MomentoDelGuion[], id: string): MomentoDelGuion | null {
  return guion.find((momento) => momento.id === id) ?? null;
}
