import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The input box's corner buttons and chip rows must not hang on the
// shadcn Button size classes: a Button restyle once shrank the mic and
// send buttons from 28px to 24.5px while their offsets stayed tuned for
// 28px, so both sat high in the text line.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");
const base = read("app/styles/base.css");
const composer = read("components/chat/composer/composer.module.css");
const voice = read("components/chat/composer/voice/voice.module.css");
const inputRow = read("components/chat/composer/input/chat-input-row.module.css");

const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `missing ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

test("composer action geometry is defined once, in tokens", () => {
  assert.match(base, /--composer-line-h:\s*46px/);
  assert.match(base, /--composer-action-size:\s*28px/);
  assert.match(base, /--composer-action-inset:\s*calc\(\(var\(--composer-line-h\) - var\(--composer-action-size\)\) \/ 2\)/);
  assert.match(base, /--composer-action-top:/);
  assert.match(base, /--composer-action-hover:/);
});

test("mic and send take their size and place from the tokens", () => {
  for (const [css, selector, side] of [
    [composer, ".actionBtn", "right"],
    [voice, ".micBtn", "left"],
  ]) {
    const body = rule(css, selector);
    assert.match(body, /width: var\(--composer-action-size\)/);
    assert.match(body, /height: var\(--composer-action-size\)/);
    assert.match(body, /top: var\(--composer-action-top\)/);
    assert.match(body, new RegExp(`${side}: var\\(--composer-action-inset\\)`));
  }
  assert.match(rule(voice, ".micBtn:hover"), /background: var\(--composer-action-hover\)/);
  assert.match(rule(voice, ".strip"), /top: var\(--composer-action-top\)/);
});

test("no hand-tuned pixel offsets are left for the corner buttons", () => {
  for (const css of [composer, voice, inputRow]) {
    assert.doesNotMatch(css, /calc\(100% - 37px\)/);
    assert.doesNotMatch(css, /padding-right: 151px/);
  }
  assert.doesNotMatch(inputRow, /padding: 12px 42px 12px 43px/);
});

test("the control row is as tall as its chips, not a fixed height", () => {
  const row = rule(composer, ".controlsRow");
  assert.doesNotMatch(row, /^\s*(min-)?height:/m);
  assert.match(row, /margin: 10px auto 0/);
  assert.match(rule(composer, ".controlsRow :global(.effort-pill-host)"), /^\s*height: auto;/m);
});
