// Every local module the shell loads must be in electron-builder's "files"
// list. A module left out works from the checkout and stops the packaged
// App before its first window opens.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packaged = new Set(require(path.join(root, "package.json")).build.files);
const entries = ["main.js", "preload.js"];

function localRequires(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const found = [];
  for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    let target = path.relative(root, path.resolve(path.dirname(path.join(root, file)), match[1]));
    if (!target.endsWith(".js") && !target.endsWith(".cjs") && !target.endsWith(".json")) target += ".js";
    found.push(target.split(path.sep).join("/"));
  }
  return found;
}

const seen = new Set();
const missing = [];
const queue = [...entries];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!packaged.has(file)) missing.push(file);
  if (fs.existsSync(path.join(root, file))) queue.push(...localRequires(file));
}

assert.deepEqual(missing, [], `not in package.json build.files: ${missing.join(", ")}`);
console.log(`packaged files: ${seen.size} local modules are all packaged`);
