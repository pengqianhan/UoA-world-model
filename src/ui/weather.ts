// Current weather in Auckland from Open-Meteo (no key, no account). Purely decorative context for
// "Now" mode; if the request fails the weather is simply not shown.
import { signal } from "@preact/signals";

export interface Weather {
  temperature: number;
  kind: "clear" | "partlyCloudy" | "cloudy" | "fog" | "drizzle" | "rain" | "showers" | "thunder" | "snow";
}

export const weather = signal<Weather | undefined>(undefined);

/** WMO weather interpretation codes, grouped. */
function kindOf(code: number): Weather["kind"] {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partlyCloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || code === 80) return "rain";
  if (code === 81 || code === 82) return "showers";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "cloudy";
}

export async function loadWeather(): Promise<void> {
  try {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=-36.8523&longitude=174.7691&current=temperature_2m,weather_code&timezone=Pacific%2FAuckland";
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const json = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
    const c = json.current;
    if (typeof c?.temperature_2m !== "number" || typeof c.weather_code !== "number") return;
    weather.value = { temperature: c.temperature_2m, kind: kindOf(c.weather_code) };
  } catch {
    // Offline or blocked: carry on without weather.
  }
}
