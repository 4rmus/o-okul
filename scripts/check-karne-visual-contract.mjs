import { readFileSync } from "node:fs";

const files = {
  decisions: readFileSync("docs/DECISIONS.md", "utf8"),
  diffScript: readFileSync("scripts/compare-karne-visual-evidence.mjs", "utf8"),
  targetScript: readFileSync("scripts/check-adiguzel-pdf-visual-targets.mjs", "utf8"),
  packageJson: JSON.parse(readFileSync("package.json", "utf8")),
};

const failures = [];
const decisionTokens = [
  "DEC-20260613-04",
  "V1 karne g\u00f6rsel kabul e\u015fi\u011fi",
  "Durum: Onayl\u0131",
  "pnpm karne:visual-targets",
  "pnpm karne:visual-diff -- --target iSEM --ui <png> --max-diff-ratio 0.53 --max-mean-channel-delta 36",
  "Ger\u00e7ek kurum logosu",
  "\u00fcr\u00fcn sahibi",
];
const diffScriptTokens = [
  "--max-diff-ratio",
  "--max-mean-channel-delta",
  "KARNE_VISUAL_DIFF_TOO_HIGH",
  "KARNE_VISUAL_MEAN_DELTA_TOO_HIGH",
  "meanChannelDelta",
  "expectedSize = { height: 842, width: 595 }",
];
const targetScriptTokens = [
  "d3a54d78fb9850b2c99e0de478d98ee025526c41677632291c302313602dfe0a",
  "e7663415dec99701151b20ac9af2d6861cd1a365f00d921a563d642f89b08494",
  "7fc8740c2453145358806b9310373fbacde0829bae28f8d61952dfa0e89830ac",
  "expectedSize = { height: 842, width: 595 }",
];

requireTokens("docs/DECISIONS.md", files.decisions, decisionTokens, failures);
requireTokens("scripts/compare-karne-visual-evidence.mjs", files.diffScript, diffScriptTokens, failures);
requireTokens("scripts/check-adiguzel-pdf-visual-targets.mjs", files.targetScript, targetScriptTokens, failures);

const scripts = files.packageJson.scripts ?? {};
if (scripts["karne:visual-contract:check"] !== "node scripts/check-karne-visual-contract.mjs") {
  failures.push("package.json karne:visual-contract:check must run node scripts/check-karne-visual-contract.mjs.");
}
if (!scripts.ci?.includes("pnpm karne:visual-contract:check")) {
  failures.push("package.json ci script must run karne:visual-contract:check.");
}

if (failures.length > 0) {
  console.error("Karne visual contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Karne visual contract check passed.");

function requireTokens(path, source, tokens, output) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      output.push(`${path} missing expected token: ${token}`);
    }
  }
}
