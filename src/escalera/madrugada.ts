/**
 * The madrugada answer: when Patricia writes between 00:00 and 05:30, Luna
 * answers each message with a short voice note that calms her, with no figure
 * and no propuesta, and keeps her worry for the next cita (GLOSSARY,
 * Madrugada). Fixed text, never generated: nobody is awake to check an LLM.
 * It names no day or hour, since the next cita may be tomorrow or in three days.
 */

// Wording pending clinical review by Cristian, issue #69.
/** The first answer of the night. */
export const MADRUGADA_TEXT =
  "Aquí estoy, Patty. De noche todo se ve más grande. Ya anoté lo que te preocupa, y lo vemos juntas en nuestra próxima cita. Ahora no tienes que resolver nada. Intenta descansar.";

/** Every later answer the same night: shorter, so three notes do not repeat the same words. */
export const MADRUGADA_TEXT_OTRA_VEZ =
  "Te escucho, Patty. Lo anoté también, no se pierde nada. Con la luz del día todo pesa menos. Intenta descansar.";
