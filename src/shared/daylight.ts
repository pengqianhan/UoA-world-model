// A rough daylight model for Auckland, used only to choose between day and night lighting.
// It is an approximation (within about a quarter of an hour), not an ephemeris.
import { aucklandInstant, aucklandOffsetMinutes, parseIsoDate } from "./time.ts";

function dayOfYear(date: string): number {
  const p = parseIsoDate(date);
  if (!p) return 1;
  return Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400000) + 1;
}

/** Approximate sunrise and sunset in Auckland, in minutes after local midnight on the clock in force. */
export function sunTimes(date: string): { sunrise: number; sunset: number } {
  // Half the day length swings between about 4.85 h (June solstice) and 7.3 h (December solstice).
  const half = 6.08 - 1.23 * Math.cos((2 * Math.PI * (dayOfYear(date) - 172)) / 365);
  // Solar noon is near 12:25 New Zealand Standard Time; shift by an hour during daylight saving.
  const dst = aucklandOffsetMinutes(aucklandInstant(date, 720)) - 720;
  const noon = 12 * 60 + 25 + dst;
  return { sunrise: Math.round(noon - half * 60), sunset: Math.round(noon + half * 60) };
}

/** 0 in full daylight, 1 at night, easing through about 80 minutes of twilight around each end. */
export function nightAmount(date: string, minutes: number): number {
  const { sunrise, sunset } = sunTimes(date);
  const twilight = 40;
  const smooth = (x: number) => {
    const k = Math.max(0, Math.min(1, x));
    return k * k * (3 - 2 * k);
  };
  if (minutes <= sunrise - twilight || minutes >= sunset + twilight) return 1;
  if (minutes < sunrise + twilight) return 1 - smooth((minutes - (sunrise - twilight)) / (2 * twilight));
  if (minutes > sunset - twilight) return smooth((minutes - (sunset - twilight)) / (2 * twilight));
  return 0;
}
