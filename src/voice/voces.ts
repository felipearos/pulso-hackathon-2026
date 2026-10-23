/** The two voices Luna can speak with; Patricia chooses one in the bienvenida. */
export type Voz = "principal" | "otra";

export const VOZ_PRINCIPAL: Voz = "principal";
export const VOZ_OTRA: Voz = "otra";

/** The voz stored for Patricia: `"otra"` if she chose it, the principal voice otherwise. */
export function vozDe(voz: string | null): Voz {
  return voz === VOZ_OTRA ? VOZ_OTRA : VOZ_PRINCIPAL;
}

/**
 * The ElevenLabs voice id for a voz. The other voice falls back to the
 * principal one while `ELEVENLABS_VOICE_ID_OTRA` is not set.
 */
export function voiceIdFor(voz: Voz, env: Record<string, string | undefined>): string | undefined {
  if (voz === VOZ_OTRA && env.ELEVENLABS_VOICE_ID_OTRA) return env.ELEVENLABS_VOICE_ID_OTRA;
  return env.ELEVENLABS_VOICE_ID;
}
