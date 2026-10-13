// Small shared pieces: icons, text helpers.
import type { ComponentChildren } from "preact";
import { formatDate, has, pick, t } from "../app/i18n.ts";
import type { AppData } from "../app/data.ts";
import { formatMinutes, weekdayKey } from "../shared/time.ts";
import type { Building, Session } from "../shared/types.ts";

const paths: Record<string, string> = {
  search: "M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25 1.42-1.42-4.25-4.24A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 6h2v7h-2v-7Zm1-3.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z",
  close: "m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z",
  back: "M14.7 5.3 8 12l6.7 6.7 1.4-1.4L10.8 12l5.3-5.3-1.4-1.4Z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v4.6l3.2 3.2-1.4 1.4-3.8-3.8V7Z",
  pin: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",
  building: "M4 21V5l8-3v4l8 2v13h-6v-4h-4v4H4Zm3-12v2h2V9H7Zm0 4v2h2v-2H7Zm8-2v2h2v-2h-2Zm0 4v2h2v-2h-2Z",
  book: "M5 3h11a3 3 0 0 1 3 3v15H7a2 2 0 0 1-2-2V3Zm2 2v12h10V6a1 1 0 0 0-1-1H7Zm2 3h6v2H9V8Z",
  arrow: "m9.3 5.3 6.7 6.7-6.7 6.7-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z",
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
};

// The GitHub mark fills its whole box; the wider frame brings it down to the size of the others.
const boxes: Record<string, string> = { github: "-2 -2 28 28" };

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox={boxes[name] ?? "0 0 24 24"} aria-hidden="true" focusable="false">
      <path d={paths[name] ?? ""} fill="currentColor" />
    </svg>
  );
}

export function IconButton(props: { icon: string; label: string; onClick: () => void; class?: string; text?: string; pressed?: boolean; id?: string }) {
  return (
    <button
      type="button"
      id={props.id}
      class={`btn ${props.class ?? ""}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      {props.text && <span class="btn-text">{props.text}</span>}
    </button>
  );
}

/** A building's display name; plain "Building 113" names are not repeated after the number. */
export function buildingTitle(b: Building): string {
  const name = pick(b.name);
  return /^Building \d/.test(name) ? "" : name;
}

export function campusName(d: AppData, id: string): string {
  return pick(d.campusById.get(id)?.name) || id;
}

export function componentName(code: string): string {
  const key = `session.component.${code}`;
  return has(key) ? t(key) : code;
}

export function sessionTimes(s: Session): string {
  return t("session.range", { start: formatMinutes(s.start), end: formatMinutes(s.end) });
}

export function sessionDay(s: Session): string {
  return t(`time.days.${weekdayKey(s.day)}`);
}

export function sessionDates(s: Session): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return t("session.dates", { start: formatDate(s.startDate, opts), end: formatDate(s.endDate, opts) });
}

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
