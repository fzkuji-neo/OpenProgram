import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The rows tucked on any click in the box's padding, including the 12px
// above and below the text and the gaps beside the mic and send, so the
// switch sat well inside the box. Only the outer rim tucks now; the inner
// padding belongs to the text field.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("only the input box's rim tucks the rows", () => {
  const hook = read("components/chat/composer/controls/use-tucked-controls.ts");
  assert.match(hook, /const RIM_PX = 6;/);
  assert.match(hook, /Math\.min\(x, y, r\.width - x, r\.height - y\) <= RIM_PX/);
  assert.match(hook, /if \(!onRim\(event\)\) \{[\s\S]*?field\.focus\(\);[\s\S]*?return;\n\s+\}\n\s+setCovering\(true\);/);
  const box = read("components/chat/composer/index.tsx");
  assert.match(box, /onPointerMove=\{tuck\.onBoxPointerMove\}/);
  const css = read("components/chat/composer/composer.module.css");
  assert.match(css, /\.inputWrapper\[data-tuckable\] \{\n\s+cursor: text;/);
  assert.match(css, /\.inputWrapper\[data-tuckable\]\[data-tuck-rim\] \{\n\s+cursor: pointer;/);
});
