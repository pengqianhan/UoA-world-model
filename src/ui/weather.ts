// Current weather in Auckland from Open-Meteo (no key, no account). Context for "Now" mode: the
// temperature in the top bar, and the sky, light and rain in the scene. If the request fails the
// weather is simply not shown, and the scene keeps a clear day.
import { signal } from "@preact/signals";

export interface Weather {
  temperature: number;
  kind: "clear" | "partlyCloudy" | "cloudy" | "fog" | "drizzle" | "rain" | "showers" | "thunder" | "snow";
  /** Share of the sky under cloud, 0-1. */
  cloud: number;
  /** Rain in the last hour, millimetres. */
  precipitation: number;
  /** Compass bearing the wind blows from, degrees. */
  windFrom: number;
  /** Wind speed at 10 m, km/h. */
  windSpeed: number;
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

export const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=-36.8523&longitude=174.7691" +
  "&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m&timezone=Pacific%2FAuckland";

export async function loadWeather(): Promise<void> {
  try {
    const res = await fetch(WEATHER_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const json = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        cloud_cover?: number;
        precipitation?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
      };
    };
    const c = json.current;
    if (typeof c?.temperature_2m !== "number" || typeof c.weather_code !== "number") return;
    const num = (v: number | undefined, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    weather.value = {
      temperature: c.temperature_2m,
      kind: kindOf(c.weather_code),
      cloud: Math.max(0, Math.min(1, num(c.cloud_cover, 0) / 100)),
      precipitation: Math.max(0, num(c.precipitation, 0)),
      windFrom: num(c.wind_direction_10m, 225),
      windSpeed: Math.max(0, num(c.wind_speed_10m, 0)),
    };
  } catch {
    // Offline or blocked: carry on without weather.
  }
}
