/**
 * DS Atelier Prompt 2 — bulk class migration for tangodb/src
 * Run: node scripts/migrate-atelier-prompt2.mjs
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
  [/slate-50\/95/g, "ink-50/10"],
  [/slate-100\/80/g, "ink-100/10"],
  [/slate-200\/70/g, "ink-200/10"],
  [/indigo-50\/60/g, "gold-50/10"],
  [/indigo-50\/30/g, "gold-50/10"],
  [/rose-50\/60/g, "garnet-50/10"],
  [/rose-50\/80/g, "garnet-50/10"],
  [/rose-200\/80/g, "garnet-200"],
  [/amber-50\/60/g, "amber-50/10"],
  [/amber-50\/80/g, "amber-50"],
  [/amber-50\/50/g, "amber-50/10"],
  [/slate-900\/40/g, "ink-950/40"],
  [/slate-900\/50/g, "ink-950/40"],
  [/slate-900\/60/g, "ink-950/40"],
  [/blue-900\/50/g, "lavender-900/70"],

  // Family swaps
  [/\bslate-/g, "ink-"],
  [/\bindigo-/g, "gold-"],
  [/\bsky-/g, "lavender-"],
  [/\bviolet-/g, "lavender-"],
  [/\bemerald-/g, "sage-"],
  [/\brose-/g, "garnet-"],
  [/\bred-/g, "garnet-"],
  [/\bblue-/g, "lavender-"],

  // §2.2 gold link text (after indigo→gold)
  [/text-gold-600\b/g, "text-gold-700"],
  [/hover:text-gold-600\b/g, "hover:text-gold-800"],

  // btnAddSoftCls / btnOpenCls: text-gold-700 stays; border-gold-100 → keep
  // ring-gold-500 for selection highlights — OK per §2.2

  // Amber normalization (only 50/200/700 allowed)
  [/border-amber-100\b/g, "border-amber-200"],
  [/bg-amber-100\b/g, "bg-amber-50"],
  [/text-amber-900\b/g, "text-amber-700"],
  [/text-amber-800\b/g, "text-amber-700"],
  [/text-amber-600\b/g, "text-amber-700"],
  [/hover:text-amber-800\b/g, "hover:text-amber-700"],

  // Remaining non-standard opacity → nearest allowed (§3)
  [/ink-50\/80/g, "ink-50/10"],
  [/ink-50\/60/g, "ink-50/10"],
  [/ink-50\/50/g, "ink-50/10"],
  [/ink-50\/95/g, "ink-50/10"],
  [/ink-100\/80/g, "ink-100/10"],
  [/ink-200\/70/g, "ink-200/10"],
  [/gold-50\/60/g, "gold-50/10"],
  [/gold-50\/30/g, "gold-50/10"],
  [/garnet-50\/60/g, "garnet-50/10"],
  [/garnet-50\/80/g, "garnet-50/10"],
  [/ink-900\/40/g, "ink-950/40"],
  [/ink-900\/30/g, "ink-950/40"],
  [/ink-900\/50/g, "ink-950/40"],
  [/ink-900\/60/g, "ink-950/40"],
  [/lavender-900\/50/g, "lavender-900/70"],
  [/border-ink-200\/90/g, "border-ink-200"],
  [/border-garnet-200\/80/g, "border-garnet-200"],

  // Second pass — remaining non-standard opacity (§3)
  [/lavender-50\/80/g, "lavender-50/10"],
  [/amber-200\/80/g, "amber-200"],
  [/text-amber-700\/90/g, "text-amber-700"],
  [/text-amber-700\/80/g, "text-amber-700"],
  [/border-ink-200\/60/g, "border-ink-200"],
  [/bg-white\/70/g, "bg-white"],
  [/border-lavender-200\/80/g, "border-lavender-200"],
  [/lavender-50\/60/g, "lavender-50/10"],
  [/gold-50\/50/g, "gold-50/10"],
  [/lavender-50\/50/g, "lavender-50/10"],
  [/gold-50\/80/g, "gold-50/10"],
  [/text-gold-800\/90/g, "text-gold-800"],
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

// Report remaining legacy
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
  console.log("No legacy color families remaining in tangodb/src.");
}
