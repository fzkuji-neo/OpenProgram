import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { browserPageShortcut } from "../../lib/browser/browser-layout.ts";

const key = (k) => ({ key: k, metaKey: true, ctrlKey: false });

test("page shortcuts map Cmd+L, Cmd+[ and Cmd+] like a browser", () => {
  assert.equal(browserPageShortcut(key("l")), "focus-address");
  assert.equal(browserPageShortcut(key("L")), "focus-address");
  assert.equal(browserPageShortcut(key("[")), "back");
  assert.equal(browserPageShortcut(key("]")), "forward");
  assert.equal(browserPageShortcut({ key: "l", metaKey: false, ctrlKey: false }), null);
});

test("Cmd+R is left to the App menu, which reloads the active page", () => {
  assert.equal(browserPageShortcut(key("r")), null);
  const lifecycle = readFileSync(new URL("../../components/center-tabs/tab-actions/use-tab-lifecycle.ts", import.meta.url), "utf8");
  assert.match(lifecycle, /op-desktop-reload/);
  assert.match(lifecycle, /active\?\.kind === "web" && bridge\) bridge\.webTab\.reload\(active\.id, \{ hard \}\)/);
  const main = readFileSync(new URL("../../../desktop/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /role: "viewMenu"/, "the View menu role reloads the App window");
  assert.match(main, /click: send\("menu:reload"\)/);
});
