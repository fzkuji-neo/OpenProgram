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
  assert.match(read("app/styles/chat/bubbles.css"), /\.message-content :is\(th, td\) code \{[^}]*overflow-wrap: normal;\n\}/);
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
  assert.match(menu, /<span>\{providerName\(group\.provider\)\}<\/span>/);
  assert.match(menu, /<div className=\{GROUP_LABEL\}>\{providerName\(byProvider\[0\]\.provider\)\}<\/div>/);
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

test("The transcript has no fade at the pane's top edge", () => {
  assert.doesNotMatch(read("app/styles/chat/transcript.css"), /\.chat-area \{[^}]*mask-image/);
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

test("A reply keeps one block rhythm: a single gap between every block and every part", () => {
  const bubbles = read("app/styles/chat/bubbles.css");
  assert.match(bubbles, /\.message \{[^}]*--reply-gap: 12px;/);
  // The markdown is one grid column; its blocks carry no margins of their own.
  assert.match(bubbles, /\.message-content \.md-rendered \{[^}]*display: grid;[^}]*gap: var\(--reply-gap\);/);
  assert.match(bubbles, /\.message-content \.md-rendered > \* \{ margin: 0; \}/);
  // Headings alone: half a gap more above, a third less below.
  assert.match(bubbles, /> :is\(h1, h2, h3, h4, h5, h6\) \{\s*margin: calc\(var\(--reply-gap\) \/ 2\) 0 calc\(var\(--reply-gap\) \/ -3\);/);
  // A reply's gap is measured between ink: text blocks trim their leading,
  // the summary row gives back its empty row, and the reply's gap is 22px.
  assert.match(bubbles, /\.message\.assistant \{ --reply-gap: 22px; \}/);
  assert.match(bubbles, /> \.md-rendered > :is\(p, ul, ol, h1, h2, h3, h4, h5, h6\) \{\s*text-box: trim-both cap alphabetic;\s*padding-block: 1\.6px;/);
  assert.match(bubbles, /> \.md-rendered > p:has\(> code\) \{ padding-block: 3\.8px 6\.1px; \}/);
  assert.match(read("app/styles/chat/execution-strip.css"), /\.chat-stream-body > \.tl\[data-open="0"\] \{ margin-bottom: -7\.5px; \}/);
  // No pairwise compensation is left anywhere.
  for (const f of ["bubbles.css", "message-actions.css", "execution-strip.css", "stream-blocks.css"]) {
    assert.doesNotMatch(read(`app/styles/chat/${f}`), /:has\(> \.md-rendered/);
  }
  assert.match(read("app/styles/chat/stream-blocks.css"), /\.chat-stream-body \{[^}]*gap: var\(--reply-gap, 12px\);/);
  assert.match(read("app/styles/chat/execution-strip.css"), /\.tl \{[^}]*margin: 0;/);
  assert.match(read("app/styles/chat/message-actions.css"),
    /\.message\.assistant \.message-actions-footer \{[^}]*margin-top: calc\(var\(--reply-gap, 12px\) - 3px\);/);
});

test("Reply markdown wears the Claude app's styles", () => {
  const bubbles = read("app/styles/chat/bubbles.css");
  // Headings: bold at 22 / 18 / 16px.
  assert.match(bubbles, /\.message-content :is\(h1, h2, h3, h4, h5, h6\) \{[^}]*font-weight: 700;/);
  assert.match(bubbles, /\.message-content h1 \{ font-size: 1\.375rem; \}/);
  assert.match(bubbles, /\.message-content h2 \{ font-size: 1\.125rem; \}/);
  // Tables, Codex's: the full column wide in a scroll wrapper, a hairline
  // under each row but the last, quiet code chips; pulled in by their insets.
  assert.match(bubbles, /\.message-content \.md-table \{ overflow-x: auto; \}/);
  assert.match(bubbles, /\.message-content table \{[^}]*width: 100%;/);
  assert.match(bubbles, /\.message-content th, \.message-content td \{[^}]*border: 0;[^}]*border-bottom: 1px solid/);
  assert.match(bubbles, /\.message-content th \{[^}]*background: transparent;[^}]*font-weight: 600;/);
  assert.match(bubbles, /\.message-content tbody tr:last-child td \{ border-bottom: 0; \}/);
  assert.match(bubbles, /\.message-content :is\(th, td\) code \{[^}]*color: inherit;[^}]*box-shadow: inset 0 0 0 1px/);
  assert.match(bubbles, /> \.md-table:not\(:first-child\) \{ margin-top: -9px; \}/);
  assert.match(bubbles, /> \.md-table:not\(:last-child\) \{ margin-bottom: -13px; \}/);
  assert.match(read("components/chat/messages/markdown.ts"), /replace\(\/<table>\/g, '<div class="md-table"><table>'\)/);
  // Inline code chip and the code card whose copy button shows on hover.
  assert.match(bubbles, /\.message-content code \{[^}]*border: 0\.5px solid[^}]*color: var\(--accent-red\);/);
  assert.match(bubbles, /\.md-code-head \.md-code-copy \{ opacity: 0;/);
  assert.match(bubbles, /\.message\.assistant \.message-content \{ line-height: 1\.6; \}/);
});

test("a long address breaks inside the tip instead of running out of it", () => {
  const tips = read("components/control-tips.tsx");
  assert.match(tips, /max-w-\[min\(360px,calc\(100vw-16px\)\)\] whitespace-pre-line \[overflow-wrap:anywhere\]/);
  // A web tab names a local page by its path and decodes escapes elsewhere.
  const tabs = read("components/center-tabs/tab-items.tsx");
  assert.match(tabs, /tab\.kind === "web" \? readableUrl\(tab\.url\)/);
  assert.match(tabs, /const local = localPathFromUrl\(url\);\n\s+if \(local\) return local;\n\s+try \{\n\s+return decodeURI\(url\);/);
});
