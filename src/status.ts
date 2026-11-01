/**
 * The one-line summary at the bottom of the panel. Kept apart from the panel
 * so it can be tested without @decky/ui.
 */
import type { IdleParts } from "./steam/idle";

/** Joins words as "a, b and c". */
function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Describes which of Steam's timers are currently being held off. */
export function statusText(overridden: IdleParts): string {
  const { dim, suspend, screensaver } = overridden;
  if (dim && suspend && screensaver) {
    return "The screen will not dim, the screensaver will not start and the Deck will not sleep.";
  }
  if (!dim && !suspend && !screensaver) {
    return "Steam's normal dim, screensaver and sleep timers apply.";
  }

  const held: string[] = [];
  const normal: string[] = [];
  if (dim) held.push("the screen will not dim");
  else normal.push("dimming");
  if (screensaver) held.push("the screensaver will not start");
  else normal.push("the screensaver");
  if (suspend) held.push("the Deck will not sleep");
  else normal.push("sleep");

  const verb = normal.length === 1 ? "is" : "are";
  const timers = normal.length === 1 ? "timer" : "timers";
  return `${capitalize(listWords(held))}. ${capitalize(listWords(normal))} ${verb} on Steam's normal ${timers}.`;
}
