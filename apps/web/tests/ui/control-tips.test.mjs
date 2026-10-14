import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("collapsed rails name their icons on hover, with no native title", () => {
  const tips = read("components/control-tips.tsx");
  assert.match(tips, /const RAIL = "\.sidebar\.collapsed :is\(\.sidebar-nav-item, \[data-rail-tip\]\), \.sidebar \.sidebar-toggle";/);
  assert.match(tips, /className="hover-tip rail-tip/, "the app's own tip look");
  assert.match(read("components/app-shell.tsx"), /<Sidebar \/>\n\s+<ControlTips \/>/);
  const left = read("components/sidebar/sidebar.tsx"), right = read("components/right-sidebar/right-sidebar.tsx");
  assert.match(left, /aria-label=\{open \? text\("Hide sidebar", "隐藏侧边栏"\) : text\("Show sidebar", "显示侧边栏"\)\}/);
  assert.match(right, /aria-label=\{open \? text\("Hide panel", "隐藏面板"\) : text\("Show panel", "显示面板"\)\}/);
  assert.doesNotMatch(right, /title=\{text\("(Project files|Agents and programs in this conversation|Session resources)"/);
  assert.doesNotMatch(left + right, /title=\{t\("(sidebar\.toggle|right\.toggle_panel)"\)\}/);
});

test("inline code in a table cell keeps whole words", () => {
  assert.match(read("app/styles/chat/bubbles.css"), /\.message-content :is\(th, td\) code \{ overflow-wrap: normal; \}/);
});

test("provider detail sections never share a React key", () => {
  // Siblings keyed alike made React leave a second API Base URL block behind.
  const detail = read("components/settings/providers/detail.tsx");
  const keys = [...detail.matchAll(/key=\{`\$\{provider\.id\}:([a-z-]+)`\}/g)].map(m => m[1]);
  assert.deepEqual(keys, ["accounts", "base-url", "check"]);
  assert.doesNotMatch(detail, /key=\{provider\.id\}/);
});

test("the user menu names full screen in the interface language", () => {
  assert.match(read("components/user-menu-footer.tsx"), /text\("Full Screen", "全屏"\)/);
});

test("the model menu names providers as Settings does", () => {
  const menu = read("components/chat/top-bar/agent-selector.tsx");
  assert.match(menu, /<div className=\{GROUP_LABEL\}>\{providerName\(group\.provider\)\}<\/div>/);
  assert.match(menu, /href="\/settings\/providers"/, "enabling models opens the providers page");
});

test("a control's native title becomes the app's tip", () => {
  const tips = read("components/control-tips.tsx");
  assert.match(tips, /const CONTROL = ":is\(button, a\[href\], \[role=button\], \[role=tab\], \[role=menuitem\], \[role=switch\], summary\):is\(\[title\], \[data-tip\]\), \[data-tip\]";/, "controls and explicit marks only, never text");
  assert.match(tips, /el\.dataset\.tip = title;\n\s+el\.removeAttribute\("title"\);/, "the system tip never comes up");
});

test("A tab on a management page wears that page's rail icon", () => {
  const items = readFileSync(new URL("../../components/center-tabs/tab-items.tsx", import.meta.url), "utf8");
  assert.equal(items.match(/routePageIcon\(tab\.navigationRoute, 13\) \?\?/g)?.length, 2);
  const icons = readFileSync(new URL("../../components/center-tabs/route-page-icon.tsx", import.meta.url), "utf8");
  for (const root of ["agents", "programs", "applications", "chats", "scheduler", "settings"]) assert.match(icons, new RegExp(`\\b${root}: \\w+`));
});

test("The transcript fades out under the pane's top edge", () => {
  assert.match(read("app/styles/chat/transcript.css"), /\.chat-area \{[^}]*mask-image: linear-gradient\(to bottom, transparent 0, #000 28px\);/);
});

test("A reply's first and last blocks bring no outer margin", () => {
  const css = read("app/styles/chat/bubbles.css");
  assert.match(css, /\.message-content \.md-rendered > :first-child \{ margin-top: 0; \}/);
  assert.match(css, /\.message-content \.md-rendered > :last-child \{ margin-bottom: 0; \}/);
});

test("Applications wear the glyph their manifest names", () => {
  const glyphs = read("components/applications/application-glyph.tsx");
  for (const name of ["calculator", "book-open", "file-search"]) assert.match(glyphs, new RegExp(`"?${name}"?: \\w+`));
  assert.equal(read("components/center-tabs/tab-items.tsx").match(/<ApplicationTabGlyph appId=\{tab\.applicationId\} size=\{14\} \/>/g)?.length, 2);
  assert.match(read("components/center-tabs/new-tab-page.tsx"), /<ApplicationGlyph icon=\{application\.icon\}/);
  assert.match(read("components/applications/applications-page.tsx"), /<ApplicationGlyph icon=\{application\.icon\} size=\{18\} \/>/);
  const picker = read("components/center-tabs/split-view-picker.tsx");
  assert.match(picker, /tab\.kind === "application"\) return <ApplicationTabGlyph/);
  assert.match(picker, /tab\.kind === "application"\) return text\("Application", "应用"\)/);
});

test("No element outside a control carries a native title", async () => {
  const { createRequire } = await import("node:module");
  const { readdirSync, statSync } = await import("node:fs");
  const ts = createRequire(import.meta.url)("typescript");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const controls = new Set(["button", "a", "summary", "input", "select", "textarea", "iframe"]);
  const found = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = dir + (dir.endsWith("/") ? "" : "/") + name;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx")) {
        const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = node => {
          if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[a-z]/.test(node.tagName.getText(sf)) && !controls.has(node.tagName.getText(sf))) {
            const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
            const role = attrs.find(a => a.name.getText(sf) === "role")?.initializer?.getText(sf) ?? "";
            if (attrs.some(a => a.name.getText(sf) === "title") && !/button|tab|menuitem|switch/.test(role)) found.push(`${path.slice(root.length)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
    }
  };
  walk(root + "components");
  walk(root + "app");
  assert.deepEqual(found, []);
});
