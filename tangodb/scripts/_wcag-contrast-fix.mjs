import fs from "fs";
import path from "path";

function walk(dir, exts, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "node_modules") walk(p, exts, files);
    else if (exts.some((x) => p.endsWith(x))) files.push(p);
  }
  return files;
}

function patchGoldCta(content) {
  let s = content;
  const pairs = [
    [
      "bg-gold-600 hover:bg-gold-700 text-white border-gold-600",
      "bg-gold-700 hover:bg-gold-800 text-white border-gold-700",
    ],
    ["bg-gold-600 border-gold-600 text-white", "bg-gold-700 border-gold-700 text-white"],
    ["bg-gold-600 text-white border-gold-600", "bg-gold-700 text-white border-gold-700"],
    ["bg-gold-600 hover:bg-gold-700 text-white", "bg-gold-700 hover:bg-gold-800 text-white"],
    ["bg-gold-600 text-white hover:bg-gold-700", "bg-gold-700 text-white hover:bg-gold-800"],
    ["bg-gold-600 hover:bg-gold-500", "bg-gold-700 hover:bg-gold-800"],
    ["bg-gold-600 text-white", "bg-gold-700 text-white"],
    ["bg-gold-600 rounded", "bg-gold-700 rounded"],
    ["border-gold-700 bg-gold-600", "border-gold-700 bg-gold-700"],
    ["bg-gold-600 flex items-center", "bg-gold-700 flex items-center"],
    ["flex-1 py-2.5 rounded-xl bg-gold-600", "flex-1 py-2.5 rounded-xl bg-gold-700"],
    [
      "bg-gold-600 hover:bg-gold-700 text-white shadow-xs",
      "bg-gold-700 hover:bg-gold-800 text-white shadow-xs",
    ],
    [
      "inline-flex items-center justify-center gap-2 rounded-xl bg-gold-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gold-700",
      "inline-flex items-center justify-center gap-2 rounded-xl bg-gold-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gold-800",
    ],
  ];
  for (const [from, to] of pairs) s = s.split(from).join(to);
  return s;
}

function patchLabels(content, app) {
  let s = content;
  if (app === "tangodb" || app === "landing") {
    s = s.replaceAll(
      "text-[10px] text-ink-400 font-sans uppercase tracking-wider font-semibold",
      "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold",
    );
    s = s.replaceAll(
      "text-[10px] text-ink-400 uppercase font-semibold tracking-wider",
      "text-[10px] text-ink-500 uppercase font-semibold tracking-wider",
    );
    s = s.replaceAll(
      "text-[10px] uppercase tracking-wider font-semibold text-ink-400",
      "text-[10px] uppercase tracking-wider font-semibold text-ink-500",
    );
    s = s.replace(/\btext-xs text-ink-400\b/g, "text-xs text-ink-500");
    s = s.replace(/\btext-sm text-ink-400\b/g, "text-sm text-ink-500");
    s = s.replace(/\btext-\[11px\] text-ink-400\b/g, "text-[11px] text-ink-500");
    s = s.replace(/\btext-center py-20 text-ink-400\b/g, "text-center py-20 text-ink-500");
    s = s.replace(/\btext-center py-16 text-ink-400\b/g, "text-center py-16 text-ink-500");
    s = s.replace(/\bpy-3 text-center text-ink-400\b/g, "py-3 text-center text-ink-500");
    s = s.replace(/\btext-\[10px\] text-ink-400\b/g, (match, offset) => {
      const lineStart = s.lastIndexOf("\n", offset) + 1;
      const lineEnd = s.indexOf("\n", offset);
      const line = s.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (/w-[345]-|h-[345]-/.test(line) && !/uppercase|font-semibold block|labelCls/.test(line)) {
        return match;
      }
      return "text-[10px] text-ink-500";
    });
  }
  return s;
}

const apps = [
  { dir: "tangodb/src", app: "tangodb", exts: [".tsx", ".ts"] },
  { dir: "tangodb-landing/src", app: "landing", exts: [".tsx", ".ts", ".css"] },
  { dir: "tangodb-dev-console/src", app: "dev-console", exts: [".tsx", ".ts"] },
];

const extraReps = [
  ["tracking-wider text-ink-400 block", "tracking-wider text-ink-500 block"],
  ["tracking-wider text-ink-400 font-semibold", "tracking-wider text-ink-500 font-semibold"],
  ["uppercase tracking-wider text-ink-400", "uppercase tracking-wider text-ink-500"],
  ["text-ink-400 uppercase text-[10px]", "text-ink-500 uppercase text-[10px]"],
  ['className="text-ink-400">{actor}', 'className="text-ink-500">{actor}'],
  ['className="block mt-1 text-ink-400"', 'className="block mt-1 text-ink-500"'],
  ['className="shrink-0 text-ink-400"', 'className="shrink-0 text-ink-500"'],
  ['className="text-ink-400">{t("team.auditMore"', 'className="text-ink-500">{t("team.auditMore"'],
];

let changed = 0;
for (const { dir, app, exts } of apps) {
  for (const file of walk(dir, exts)) {
    let content = fs.readFileSync(file, "utf8");
    const orig = content;
    if (/bg-gold-600/.test(content)) content = patchGoldCta(content);
    content = patchLabels(content, app);
    if (app === "tangodb") {
      for (const [from, to] of extraReps) content = content.split(from).join(to);
    }
    if (content !== orig) {
      fs.writeFileSync(file, content);
      changed++;
      console.log("updated", file);
    }
  }
}
console.log("files changed:", changed);
