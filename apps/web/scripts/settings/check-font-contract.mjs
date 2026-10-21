// Settings > General owns the typeface (`--font-sans`) and equal-width
// digits (`html[data-tabular-nums]`). A component that names its own font
// or forces `tabular-nums` stops following that setting, so neither may
// appear outside the files that implement it. Code keeps `--font-mono`.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// The files that define the stacks and apply the setting.
const OWNERS = new Set([
  "app/globals.css",
  "app/layout.tsx",
  "app/styles/base.css",
  "lib/prefs/font-stacks.ts",
  "lib/prefs/font-pref.ts",
  "components/settings/general-section.tsx",
]);

function* walk(dir) {
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) yield* walk(path);
    else if ([".css", ".ts", ".tsx"].includes(extname(name))) yield path;
  }
}

// What is left of a font value once the shared variables, sizes, weights
// and keywords are taken out; anything left is a font named by hand.
function stray(value) {
  return value
    .replace(/var\(--font-(?:sans|mono)[^)]*\)/g, "")
    .replace(/!important|\b(?:inherit|initial|unset|revert(?:-layer)?|normal|italic|bold(?:er)?|lighter)\b/g, "")
    .replace(/[\d.]+(?:px|em|rem|%)?|var\([^)]*\)|calc\([^)]*\)|[\/,\s]/g, "")
    .trim();
}

const problems = [];
for (const dir of ["app", "components", "lib"]) {
  for (const path of walk(dir)) {
    if (OWNERS.has(path)) continue;
    const lines = readFileSync(join(root, path), "utf8").split("\n");
    lines.forEach((line, index) => {
      const at = `${relative(root, join(root, path))}:${index + 1}`;
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      for (const m of line.matchAll(/font-family\s*:\s*([^;}"`]*)/g)) {
        if (stray(m[1])) problems.push(`${at} names a font: ${m[0].trim()}`);
      }
      if (path.endsWith(".css")) {
        // The shorthand also resets font-variant-numeric, which silently
        // switches equal-width digits off for the whole subtree.
        for (const m of line.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]*)/g)) {
          if (!/^(?:inherit|revert-layer)$/.test(m[1].trim())) {
            problems.push(`${at} uses the font shorthand; write font-size / font-family instead`);
          }
        }
      }
      for (const m of line.matchAll(/fontFamily\s*:\s*(["'])([^"']*)\1/g)) {
        if (stray(m[2])) problems.push(`${at} names a font: ${m[0].trim()}`);
      }
      if (/--font-(?!sans\b|mono\b)[\w-]+/.test(line)) {
        problems.push(`${at} uses a font variable other than --font-sans / --font-mono`);
      }
      if (/\bfont-\[/.test(line))problems.push(`${at} uses an arbitrary Tailwind font`);
      if (/tabular-nums|font-variant-numeric/.test(line)) {
        problems.push(`${at} forces equal-width digits; Settings decides that`);
      }
    });
  }
}

assert.deepEqual(problems, [], `Fonts must follow Settings:\n${problems.join("\n")}`);
console.log("font contract: ok");
