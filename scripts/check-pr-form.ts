// Checks that a pull request says how it was made. CI passes the description in PR_BODY
// (.github/workflows/pr-form.yml); run by hand: PR_BODY="$(gh pr view <number> --json body -q .body)" node scripts/check-pr-form.ts
import { HOW_IT_WAS_MADE, formProblems } from "./lib/pr-form.ts";

const problems = formProblems(process.env.PR_BODY ?? "");
if (problems.length) {
  for (const p of problems) console.log(`::error title=${HOW_IT_WAS_MADE}::${p}`);
  console.log(
    `\nThe pull request's "${HOW_IT_WAS_MADE}" names the model, the harness with its version and the thinking effort` +
      ` (docs/standards.md). Edit the description and this check runs again.`,
  );
  process.exit(1);
}
console.log(`"${HOW_IT_WAS_MADE}" gives the model, the harness and the thinking effort.`);
