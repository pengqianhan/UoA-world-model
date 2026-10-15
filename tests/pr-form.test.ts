import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { FIELDS, formProblems } from "../scripts/lib/pr-form.ts";

const filled = (lines: string) => `Fixes the strip.\n\n## What changed and why\n\nIt did.\n\n## How it was made\n\n${lines}\n\n## How it was checked\n\n- Red check: yes\n`;

describe("a pull request's \"How it was made\"", () => {
  it("is asked for by the form, which is not passed as it comes", () => {
    const template = fs.readFileSync(".github/pull_request_template.md", "utf8");
    // Every field is in the form, and the hints in its comments are not taken for answers.
    for (const field of FIELDS) expect(template).toMatch(new RegExp(`^- ${field}:`, "m"));
    expect(formProblems(template)).toEqual(["Model: empty.", "Harness: empty.", "Thinking effort: empty."]);
  });

  it("passes with all three given", () => {
    expect(formProblems(filled("- Model: claude-opus-5-5\n- Harness: Claude Code 2.1.300\n- Thinking effort: xhigh"))).toEqual([]);
  });

  it("reads bold labels, code spans, Windows line ends and a hint left in place", () => {
    const body = filled("* **Model:** `claude-opus-5-5`\r\n- **Harness**: Claude Code 2.1.300 <!-- the tool -->\r\n- thinking effort: default");
    expect(formProblems(body)).toEqual([]);
  });

  it("takes a change written by hand, and a further line for a helper on another model", () => {
    expect(formProblems(filled("- Model: none\n- Harness: none\n- Thinking effort: none"))).toEqual([]);
    const helpers = filled("- Model: claude-opus-5-5\n- Model: claude-haiku-5-5, for the search\n- Harness: Claude Code 2.1.300\n- Thinking effort: high");
    expect(formProblems(helpers)).toEqual([]);
  });

  it("names what is missing or empty", () => {
    expect(formProblems(filled("- Model: claude-opus-5-5\n- Thinking effort:"))).toEqual(["Harness: missing.", "Thinking effort: empty."]);
    expect(formProblems("Model: x\nHarness: y\nThinking effort: z")).toEqual(['The section "## How it was made" is missing.']);
  });

  it("looks only in its own section", () => {
    const body = "## What changed and why\n\n- Model: the massing model\n\n## How it was made\n\n- Harness: Claude Code\n- Thinking effort: high\n";
    expect(formProblems(body)).toEqual(["Model: missing."]);
  });

  it("takes \"not known\" with its reason, and not bare", () => {
    expect(formProblems(filled("- Model: claude-opus-5-5\n- Harness: a web chat\n- Thinking effort: not known: the chat does not show it"))).toEqual([]);
    expect(formProblems(filled("- Model: claude-opus-5-5\n- Harness: a web chat\n- Thinking effort: not known"))).toEqual([
      'Thinking effort: "not known" needs its reason, as "not known: <why>".',
    ]);
    expect(formProblems(filled("- Model: unknown.\n- Harness: x\n- Thinking effort: high"))).toEqual([
      'Model: "unknown." needs its reason, as "not known: <why>".',
    ]);
  });
});
