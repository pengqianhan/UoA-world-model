// Where the sun stands over the City Campus at a given Auckland date and time, and how dark it is.
// The sun's position uses NOAA's published solar-position equations (after Meeus), good to well
// under a degree for any year this site will see; that is far closer than the scene can show.
import { aucklandInstant } from "./time.ts";

/** The City Campus, where the sun is computed for every campus on the map. */
const LAT = -36.8523;
const LON = 174.7691;

const RAD = Math.PI / 180;

/** Sun direction at an instant: azimuth clockwise from north and elevation above the horizon, degrees. */
export function sunPosition(instant: Date, lat = LAT, lon = LON): { azimuth: number; elevation: number } {
  const jd = instant.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  // Equation of time, minutes.
  const eqt =
    4 *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD)) /
    RAD;
  const utcMinutes = ((instant.getTime() / 60000) % 1440 + 1440) % 1440;
  const solarMinutes = (((utcMinutes + eqt + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZenith = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
  const azimuth = (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 540) % 360;
  return { azimuth, elevation };
}

/** The sun over the City Campus when Auckland clocks show this date and time. */
export function sunAt(date: string, minutes: number): { azimuth: number; elevation: number } {
  return sunPosition(aucklandInstant(date, minutes));
}

/**
 * 0 in full daylight, 1 at night. The change runs from the sun 6° above the horizon to 8° below,
 * so it is half done at sunrise and sunset and over by the end of nautical twilight.
 */
export function nightAmount(date: string, minutes: number): number {
  const k = Math.max(0, Math.min(1, (6 - sunAt(date, minutes).elevation) / 14));
  return k * k * (3 - 2 * k);
}
