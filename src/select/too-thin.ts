import { TOO_THIN_THRESHOLD } from "../config/index.js";

/**
 * Too-thin rule (Requirement 6.2): Source_Text shorter than
 * TOO_THIN_THRESHOLD characters is thin. Pure, no I/O.
 */
export function isTooThin(sourceText: string): boolean {
  return sourceText.length < TOO_THIN_THRESHOLD;
}
