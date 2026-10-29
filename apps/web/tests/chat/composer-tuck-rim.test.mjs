import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The rows tucked on any click in the box's padding, including the 12px
// above and below the text and the gaps beside the mic and send, so the
// switch sat well inside the box. Only a band along the edge tucks now,
// 6px inside and 6px outside the box; the inner padding belongs to the
// text field.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("only a band along the input box's edge tucks the rows", () => {
  const hook = read("components/chat/composer/controls/use-tucked-controls.ts");
  assert.match(hook, /const RIM_IN = 6;\nexport const RIM_OUT = 6;/);
  assert.match(hook, /<= RIM_IN \? "band" : "inner";/);
  // The outer half is a ring element behind the box, so whatever lies
  // under the composer (a DAG canvas, the row above) cannot swallow it;
  // over a control of that row the ring steps aside.
  assert.match(hook, /if \(band && target === band\) return "band";/);
  assert.match(hook, /if \(controlUnder\(band, event\.clientX, event\.clientY\)\) band\.style\.pointerEvents = "none";/);
  assert.match(hook, /if \(spot === "inner"\) \{[\s\S]*?field\.focus\(\);[\s\S]*?return;\n\s+\}\n\s+setCovering\(true\);/);
  // On the area, so the band's outer half reaches the handler.
  const area = read("components/chat/composer/index.tsx");
  assert.match(area, /data-composer-input-area[\s\S]{0,120}onPointerDown=\{tuck\.onAreaPointerDown\}/);
  assert.match(area, /data-composer-session=\{currentSessionId\}>[\s\S]{0,200}<div ref=\{tuck\.bandRef\} className=\{styles\.tuckBand\} style=\{\{ borderRadius/);
  assert.match(hook, /band\.style\.left = `\$\{box\.offsetLeft - RIM_OUT\}px`;/);
  const css = read("components/chat/composer/composer.module.css");
  assert.match(css, /\.inputWrapper\[data-tuckable\] \{\n\s+cursor: text;/);
  assert.match(css, /\.inputArea\[data-tuck-rim\],\n\.inputArea\[data-tuck-rim\] \.inputWrapper\[data-tuckable\] \{\n\s+cursor: pointer;/);
});
