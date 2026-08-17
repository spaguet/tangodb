/**
 * DS Atelier Prompt 4 — bulk class migration for tangodb-dev-console/src
 * Run: node scripts/migrate-atelier-prompt4.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (/\.(tsx?|css)$/.test(name)) files.push(p);
  }
  return files;
}

/** Ordered replacements — specific patterns before generic family swaps */
const RULES = [
  // §3.1 opacity (before family rename)
  [/border-slate-200\/90/g, "border-ink-200"],
  [/slate-50\/80/g, "ink-50/10"],
  [/slate-50\/60/g, "ink-50/10"],
  [/slate-50\/50/g, "ink-50/10"],
  [/slate-900\/50/g, "ink-900/70"],
  [/slate-900\/40/g, "ink-950/40"],
  [/slate-900\/60/g, "ink-950/40"],
  [/indigo-50\/60/g, "gold-50/10"],
  [/indigo-50\/30/g, "gold-50/10"],
  [/rose-50\/60/g, "garnet-50/10"],
  [/rose-50\/80/g, "garnet-50/10"],
  [/amber-50\/60/g, "amber-50/10"],
  [/amber-50\/80/g, "amber-50"],
  [/blue-900\/50/g, "lavender-900/70"],
  [/emerald-900\/50/g, "sage-900/70"],
  [/emerald-900\/40/g, "sage-900/70"],
  [/rose-900\/50/g, "garnet-900/70"],
  [/rose-900\/40/g, "garnet-900/70"],
  [/indigo-900\/50/g, "gold-900/70"],
  [/indigo-600\/30/g, "gold-600/10"],
  [/indigo-500\/70/g, "gold-500/70"],
  [/amber-900\/40/g, "amber-50/10"],
  [/amber-950\/40/g, "amber-50/10"],

  // Family swaps
  [/\bslate-/g, "ink-"],
  [/\bindigo-/g, "gold-"],
  [/\bsky-/g, "lavender-"],
  [/\bviolet-/g, "lavender-"],
  [/\bemerald-/g, "sage-"],
  [/\brose-/g, "garnet-"],
  [/\bred-/g, "garnet-"],
  [/\bblue-/g, "lavender-"],

  // §2.2 gold link text (after indigo→gold) — light contexts; dark links stay gold-300/400
  [/text-gold-600\b/g, "text-gold-700"],
  [/hover:text-gold-600\b/g, "hover:text-gold-800"],

  // Amber normalization (only 50/200/700 allowed for warning UI)
  [/border-amber-100\b/g, "border-amber-200"],
  [/border-amber-900\b/g, "border-amber-200"],
  [/bg-amber-100\b/g, "bg-amber-50"],
  [/bg-amber-900\/50\b/g, "bg-ink-800"],
  [/text-amber-900\b/g, "text-amber-700"],
  [/text-amber-800\b/g, "text-amber-700"],
  [/text-amber-600\b/g, "text-amber-700"],
  [/text-amber-400\b/g, "text-amber-700"],
  [/text-amber-300\b/g, "text-amber-700"],
  [/hover:text-amber-800\b/g, "hover:text-amber-700"],
  [/hover:text-amber-300\b/g, "hover:text-amber-700"],
  [/hover:bg-amber-600\b/g, "hover:bg-garnet-700"],
  [/bg-amber-700\b/g, "bg-garnet-600"],
  [/bg-amber-600\b/g, "bg-garnet-600"],

  // Remaining non-standard opacity → nearest allowed (§3)
  [/ink-50\/80/g, "ink-50/10"],
  [/ink-50\/60/g, "ink-50/10"],
  [/ink-900\/40/g, "ink-950/40"],
  [/ink-900\/50/g, "ink-900/70"],
  [/ink-900\/60/g, "ink-950/40"],
  [/gold-50\/60/g, "gold-50/10"],
  [/garnet-50\/60/g, "garnet-50/10"],
  [/lavender-900\/50/g, "lavender-900/70"],
  [/sage-900\/40/g, "sage-900/70"],
  [/garnet-900\/40/g, "garnet-900/70"],
];

const LEGACY_RE = /(?:^|[^a-z-])(slate|indigo|sky|violet|emerald|rose|red|blue)-/;

let changedFiles = 0;
for (const file of walk(SRC)) {
  const original = readFileSync(file, "utf8");
  let content = original;
  for (const [from, to] of RULES) {
    content = content.replace(from, to);
  }
  if (content !== original) {
    writeFileSync(file, content, "utf8");
    changedFiles++;
  }
}

const remaining = [];
for (const file of walk(SRC)) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (LEGACY_RE.test(line)) {
      remaining.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
}

console.log(`Updated ${changedFiles} files.`);
if (remaining.length) {
  console.log(`\nRemaining legacy (${remaining.length} lines):`);
  remaining.slice(0, 50).forEach((l) => console.log(l));
  if (remaining.length > 50) console.log(`... and ${remaining.length - 50} more`);
  process.exit(1);
} else {
  console.log("No legacy color families remaining in tangodb-dev-console/src.");
}
