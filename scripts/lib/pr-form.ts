// The "How it was made" section of a pull request: the model that wrote the change, the harness
// that ran it and the thinking effort it was set to (docs/standards.md). What the contributor
// writes cannot be checked; that it is written can.

export const HOW_IT_WAS_MADE = "How it was made";
export const FIELDS = ["Model", "Harness", "Thinking effort"] as const;

/**
 * What is missing from a pull request's "How it was made", one line each; none when the section
 * gives all three fields. Comments do not count, so the form's own hints are not answers. A value
 * that says "not known" must say why.
 */
export function formProblems(body: string): string[] {
  const text = body.replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/\r\n?/g, "\n");
  const heading = new RegExp(`^##\\s+${HOW_IT_WAS_MADE}\\s*$`, "im").exec(text);
  if (!heading) return [`The section "## ${HOW_IT_WAS_MADE}" is missing.`];
  const rest = text.slice(heading.index + heading[0].length);
  const section = rest.slice(0, /^##\s/m.exec(rest)?.index ?? rest.length);

  const values = new Map<string, string>();
  for (const line of section.split("\n")) {
    // "- Model: x", "* **Model:** x" and "Model: `x`" all give x.
    const m = /^(model|harness|thinking effort)\s*:\s*(.*)$/i.exec(line.replace(/[*_`]/g, "").trim().replace(/^[-+]\s*/, ""));
    const field = m && FIELDS.find((f) => f.toLowerCase() === m[1]!.toLowerCase());
    if (field && !values.has(field)) values.set(field, m[2]!.trim());
  }
  const problems: string[] = [];
  for (const field of FIELDS) {
    const value = values.get(field);
    if (value === undefined) problems.push(`${field}: missing.`);
    else if (!value) problems.push(`${field}: empty.`);
    else if (/^(not known|unknown)\W*$/i.test(value)) problems.push(`${field}: "${value}" needs its reason, as "not known: <why>".`);
  }
  return problems;
}
