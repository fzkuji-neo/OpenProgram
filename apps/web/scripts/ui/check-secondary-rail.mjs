// Every list column between the main sidebar and a page's content is the
// shared SecondaryRail (components/ui/secondary-rail.tsx). Pages used to
// style their own rows, and drifted: three selected colours, two search
// boxes, one rail that could collapse. A page may not bring those back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const rail = read("components/ui/secondary-rail.tsx");
const railCss = read("components/ui/secondary-rail.module.css");

// Rows are the main sidebar's rows, built from the shared kit.
assert.match(railCss, /\.item\s*\{[^}]*composes:\s*ui-list-item from global/s);
assert.match(railCss, /\.item\.active\s*\{[^}]*background:\s*var\(--bg-hover\)/s);
for (const part of ["@/components/ui/search-input", "@/components/ui/badge", "@/components/ui/separator", "@/components/ui/tooltip", "GROUP_LABEL"]) {
  assert.ok(rail.includes(part), `SecondaryRail must build on ${part}`);
}
assert.doesNotMatch(rail, /\btitle=\{/, "Collapsed rows use HoverTip, never a native title");

// The pages with a list column, and their own stylesheets.
const pages = {
  "components/projects/projects-page.tsx": "components/projects/projects-page.module.css",
  "components/agents/agents-page.tsx": "components/agents/agents-page.module.css",
  "components/programs/programs-page.tsx": "components/programs/programs-page.module.css",
  "components/settings/settings-tabs-layout.tsx": "components/settings/settings-page.module.css",
  "components/chats/chats-page.tsx": "components/chats/chats-page.module.css",
};
const ownRows = /\.(?:navItem|navIcon|navName|navCount|navGroupLabel|railItem\w*|railHeader|railTitle|agentNav|agentRow|agentList|profilesNav|profileItem|explorer)\s*\{/;
for (const [page, css] of Object.entries(pages)) {
  const source = read(page);
  assert.match(source, /from "(?:@\/components|\.\.)\/ui\/secondary-rail"/, `${page} must use SecondaryRail`);
  assert.match(source, /<SecondaryRail\b/, `${page} must render SecondaryRail`);
  assert.ok(!ownRows.test(read(css)), `${css} styles its own rail rows; use RailItem`);
}

// A collapsible rail and its header toggle share one key.
for (const [page, header] of [
  ["components/projects/projects-page.tsx", "components/history/history-page.tsx"],
  ["components/agents/agents-page.tsx", "components/agents/agents-page.tsx"],
  ["components/settings/settings-tabs-layout.tsx", "components/settings/settings-tabs-layout.tsx"],
]) {
  const key = read(page).match(/<SecondaryRail railKey=\{(\w+)\}/)?.[1];
  assert.ok(key, `${page} must give its rail a railKey`);
  assert.match(read(header), new RegExp(`railToggle=\\{[\\s\\S]*?<RailToggle[\\s\\S]*?railKey=\\{${key}\\}`), `${header} must show the ${key} toggle`);
}

console.log("secondary rail: ok");
