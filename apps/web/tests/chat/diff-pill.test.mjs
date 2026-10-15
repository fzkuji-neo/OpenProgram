import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("+N −N pills take the Claude app's DiffIndicator look", () => {
  const base = read("app/styles/base.css");
  assert.match(base, /--git-added: light-dark\(#1e9e3c, #32d74b\);/);
  assert.match(base, /--git-removed: light-dark\(#cd2054, #ff2c56\);/);
  const card = read("app/styles/chat/turn-files-card.css");
  assert.match(card, /\.turn-files-diff\{display:inline-flex;height:18px;border-radius:4\.5px;overflow:hidden;[^}]*font:500 11px\/14px var\(--font-system\);font-variant-numeric:tabular-nums lining-nums\}/);
  assert.match(card, /\.turn-files-stat\{display:flex;align-items:center;gap:1px;padding:0 6px\}/);
  assert.match(card, /\.turn-files-stat\.is-add\{color:var\(--git-added\);background:color-mix\(in srgb,var\(--git-added\) 20%,transparent\)\}/);
  assert.match(card, /\.turn-files-diff\.is-plain\{[^}]*\}\.turn-files-diff\.is-plain \.turn-files-stat\{padding:0;background:none\}/);
  assert.match(read("components/chat/messages/turn-files-chips.tsx"), /className="turn-files-diff is-plain"/);
  const bar = read("app/styles/chat/top-bar-chips.css");
  assert.match(bar, /\.diff-badge \{[^}]*height: 18px;[^}]*font: 500 11px\/14px var\(--font-system\);/);
  assert.match(bar, /\.diff-badge \.is-del \{\s*color: var\(--git-removed\);/);
});

test("each sign sits 1px from its count in every pill", () => {
  for (const path of [
    "components/chat/messages/turn-files-chips.tsx",
    "components/chat/messages/execution-strip.tsx",
    "components/chat/top-bar/git-chip.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /is-add">\+\{/, path);
    assert.doesNotMatch(source, /is-del">−\{/, path);
    assert.match(source, /is-add"><span>\+<\/span>\{/, path);
  }
});
