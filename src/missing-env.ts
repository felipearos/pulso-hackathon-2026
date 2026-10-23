/** A real port was called without the variables it needs. */
export class MissingEnvError extends Error {
  constructor(
    readonly port: string,
    readonly missing: string[],
  ) {
    super(`${port} port needs ${missing.join(", ")}; add them to Doppler pulso-hackathon-2026`);
    this.name = "MissingEnvError";
  }
}
