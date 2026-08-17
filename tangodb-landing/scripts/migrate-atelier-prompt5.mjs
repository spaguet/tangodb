/**
 * DS Atelier Prompt 5 — bulk class migration for tangodb-landing/src
 * Run: node scripts/migrate-atelier-prompt5.mjs
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
  // Preview traffic-light dots (§5 prompt)
  [/bg-red-300\/80/g, "bg-garnet-300/10"],
  [/bg-emerald-300\/80/g, "bg-sage-300/10"],
  [/bg-amber-300\/80/g, "bg-amber-200"],

  // §3.1 opacity (before family rename)
  [/border-slate-200\/90/g, "border-ink-200"],
  [/border-slate-200\/80/g, "border-ink-200"],
  [/border-slate-200\/70/g, "border-ink-200"],
  [/slate-50\/80/g, "ink-50/10"],
  [/slate-50\/60/g, "ink-50/10"],
  [/slate-50\/50/g, "ink-50/10"],
  [/slate-50\/95/g, "ink-50/10"],
  [/slate-100\/80/g, "ink-100/10"],
  [/slate-100\/70/g, "ink-100/10"],
  [/slate-200\/70/g, "ink-200/10"],
  [/indigo-50\/60/g, "gold-50/10"],
  [/indigo-50\/30/g, "gold-50/10"],
  [/indigo-50\/50/g, "gold-50/10"],
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
  [/border-indigo-200\/80/g, "border-gold-200"],
  [/indigo-700\/70/g, "text-gold-700"],
  [/indigo-400\/80/g, "gold-400/10"],
  [/indigo-600\/50/g, "gold-600/40"],
  [/indigo-600\/80/g, "gold-600/40"],
  [/indigo-500\/20/g, "gold-500/10"],
  [/text-indigo-600\/80/g, "text-gold-700"],
  [/bg-white\/95/g, "bg-white"],
  [/bg-white\/90/g, "bg-white"],
  [/bg-white\/70/g, "bg-white"],
  [/shadow-slate-200\/70/g, "shadow-ink-200/10"],
  [/shadow-slate-300\/50/g, "shadow-ink-300/10"],
  [/border-slate-700\/80/g, "border-ink-700/70"],
  [/bg-slate-800\/60/g, "bg-ink-800/70"],
  [/bg-slate-700\/80/g, "bg-ink-700/70"],

  // Family swaps
  [/\bslate-/g, "ink-"],
  [/\bindigo-/g, "gold-"],
  [/\bsky-/g, "lavender-"],
  [/\bviolet-/g, "lavender-"],
  [/\bemerald-/g, "sage-"],
  [/\brose-/g, "garnet-"],
  [/\bred-/g, "garnet-"],
  [/\bblue-/g, "lavender-"],

  // §2.2 gold link text on light backgrounds (after indigo→gold)
  [/text-gold-600\b/g, "text-gold-700"],
  [/hover:text-gold-600\b/g, "hover:text-gold-800"],

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
  [/ink-100\/70/g, "ink-100/10"],
  [/ink-200\/70/g, "ink-200/10"],
  [/gold-50\/60/g, "gold-50/10"],
  [/gold-50\/30/g, "gold-50/10"],
  [/gold-50\/50/g, "gold-50/10"],
  [/garnet-50\/60/g, "garnet-50/10"],
  [/garnet-50\/80/g, "garnet-50/10"],
  [/ink-900\/40/g, "ink-950/40"],
  [/ink-900\/30/g, "ink-950/40"],
  [/ink-900\/50/g, "ink-950/40"],
  [/ink-900\/60/g, "ink-950/40"],
  [/lavender-900\/50/g, "lavender-900/70"],
  [/border-ink-200\/90/g, "border-ink-200"],
  [/border-ink-200\/80/g, "border-ink-200"],
  [/border-ink-200\/70/g, "border-ink-200"],
  [/border-garnet-200\/80/g, "border-garnet-200"],
  [/border-gold-200\/80/g, "border-gold-200"],
  [/gold-600\/50/g, "gold-600/40"],
  [/gold-400\/80/g, "gold-400/10"],
  [/gold-500\/20/g, "gold-500/10"],
  [/lavender-50\/80/g, "lavender-50/10"],
  [/amber-200\/80/g, "amber-200"],
  [/text-gold-700\/70/g, "text-gold-700"],
  [/text-gold-700\/90/g, "text-gold-700"],
  [/text-gold-800\/90/g, "text-gold-800"],
  [/border-ink-200\/60/g, "border-ink-200"],
  [/bg-ink-100\/70/g, "bg-ink-100/10"],
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
  console.log("No legacy color families remaining in tangodb-landing/src.");
}
