import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupTimelineDays } from "../../components/memory/format.ts";

const normalizedText = (path) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
const memoryPage = normalizedText(
  new URL("../../components/memory/index.tsx", import.meta.url),
);
const memoryCss = normalizedText(
  new URL("../../components/memory/memory-page.module.css", import.meta.url),
);
const memoryParts = normalizedText(
  new URL("../../components/memory/parts.tsx", import.meta.url),
);
const memoryMarkdown = normalizedText(
  new URL("../../components/memory/markdown.ts", import.meta.url),
);

function cssRules(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...memoryCss.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length, `missing CSS rule: ${selector}`);
  return matches.map((match) => match[1]);
}

function cssRule(selector) {
  return cssRules(selector)[0];
}
assert.doesNotMatch(memoryPage, /styles\.writerStatus/);
assert.doesNotMatch(memoryPage, /pending turns/);
assert.doesNotMatch(memoryCss, /\.writerStatus/);
assert.doesNotMatch(memoryPage, /\/api\/memory\/status/);
assert.doesNotMatch(memoryPage, /Commitments|commitments/);
assert.doesNotMatch(memoryCss, /commitment/);
assert.doesNotMatch(memoryPage, /Memory totals/);
assert.doesNotMatch(memoryPage, /styles\.headerStats/);
assert.match(memoryPage, /useState<"injected" \| "records">\("injected"\)/);
assert.match(memoryPage, /renderedTokens/);
assert.match(memoryPage, /topics\/core\.md/);
assert.match(memoryPage, /styles\.coreViewSwitch/);
assert.match(memoryCss, /\.coreViewSwitch\s*\{/);
assert.match(memoryPage, /data\.injected_content/);
assert.match(memoryPage, /injectionEnabled/);
assert.match(memoryMarkdown, /sanitizeHtml\(renderObsidianMarkdown\(/);
assert.match(memoryMarkdown, /\(source\) => marked\.parse\(source/);
assert.match(memoryPage, /MEMORY\.md as injected/);
assert.match(memoryPage, /Source records/);
assert.match(memoryPage, /Injection enabled/);
assert.doesNotMatch(memoryPage, />\s*Injected\s*</);
assert.doesNotMatch(memoryPage, />\s*Core records\s*</);
assert.match(memoryPage, /groupTimelineDays\(timelineDays, locale\)/);
assert.match(memoryPage, /timelineGroups\.length === 0/);
assert.doesNotMatch(memoryPage, /formatDate\(day\.mtime, locale\)/);
assert.match(memoryCss, /\.coreTokenMeter\s*\{/);
assert.match(cssRule(".rightPane"), /padding:\s*14px/);
assert.match(cssRule(".rightPane"), /background:\s*var\(--bg-secondary\)/);
assert.match(cssRule(".editor"), /border:\s*1px solid var\(--border\)/);
assert.match(cssRule(".editor"), /border-radius:\s*12px/);
assert.ok(cssRules(".markdown").some((rule) => /max-width:\s*780px/.test(rule) && /margin:\s*0 auto/.test(rule)));
assert.match(cssRule(".emptyPanel"), /max-width:\s*560px/);
assert.match(cssRule(".emptyPanel"), /border:\s*1px solid var\(--border\)/);
assert.match(cssRule(".emptyPanel"), /border-radius:\s*14px/);
assert.equal((memoryPage.match(/styles\.treeEmpty/g) || []).length, 2);
assert.doesNotMatch(memoryPage, /styles\.contextHeader/);
assert.doesNotMatch(memoryPage, /styles\.coreSidebar/);
assert.match(memoryPage, /styles\.coreControls/);
assert.equal((memoryPage.match(/injectedTokens\.toLocaleString\(\)/g) || []).length, 1);
assert.match(memoryCss, /@media\s*\(max-width:\s*720px\)[\s\S]*\.treeEmpty\s*\{\s*display:\s*none/);
assert.match(memoryCss, /\.treeEmpty\s*\+\s*\.rightPane\s*\{[^}]*grid-row:\s*2\s*\/\s*-1/);
assert.match(memoryPage, /styles\.recentEvent/);
assert.match(memoryPage, /r\.headers\.get\("X-Memory-Recent-Limit"\)/);
assert.match(memoryPage, /recentEvents\.length\} \/ \{recentLimit\}/);
assert.doesNotMatch(memoryPage, /style=\{\{ marginBottom: "1rem" \}\}/);
assert.doesNotMatch(memoryParts, /styles\.editorMeta/);
assert.doesNotMatch(memoryParts, /<div className=\{styles\.editorMeta\}/);
assert.match(memoryParts, /styles\.editorHeaderMeta/);
assert.ok(cssRules(".editorHeader").some((rule) => /min-height:\s*76px/.test(rule)));
// The section list, topic tree and timeline are the shared secondary rail:
// folder glyphs mark open / closed, counts and dates sit in the trailing slot.
assert.match(memoryParts, /export function TabButton[\s\S]*<RailItem icon=\{icon\}/);
assert.match(memoryParts, /<RailItem[\s\S]*icon=\{<FolderGlyph open=\{isExpanded\} \/>\}[\s\S]*trailing=\{<RailCount>\{pages\.length\}<\/RailCount>\}[\s\S]*aria-expanded=\{isExpanded\}/);
assert.match(memoryParts, /depth=\{folder \? 1 : 0\}[\s\S]*badge=\{page\.type && page\.type !== folder \? <RailBadge>/);
assert.equal((memoryPage.match(/<SecondaryRail\b/g) || []).length, 5);
assert.match(memoryPage, /isTimelineOpen\(year\.year, yearIndex === 0\)/);
assert.match(memoryPage, /isTimelineOpen\(month\.key, yearIndex === 0 && monthIndex === 0\)/);
assert.doesNotMatch(memoryPage + memoryParts, /<details|<summary|styles\.sidebarRow|styles\.sidebarCount|DisclosureChevron/);
assert.doesNotMatch(memoryCss, /\.sidebarRow|\.sidebarCount|\.folderRow|\.fileRow|\.timelineYearSummary/);
assert.match(memoryCss, /@media\s*\(max-width:\s*720px\)[\s\S]*\.editorHeader\s*\{[^}]*flex-wrap:\s*wrap/);
assert.match(memoryCss, /@media\s*\(max-width:\s*720px\)[\s\S]*\.editorActions\s*\{[^}]*width:\s*100%[^}]*flex-wrap:\s*wrap/);

const groupedTimeline = groupTimelineDays([
  { date: "2026-08-07", size: 20, mtime: 2 },
  { date: "2025-12-31", size: 10, mtime: 1 },
  { date: "2026-08-15", size: 30, mtime: 3 },
], "en");
assert.deepEqual(
  groupedTimeline.map((year) => [year.year, year.entryCount, year.months.map((month) => [month.label, month.days.map((day) => day.dayLabel)])]),
  [["2026", 2, [["August", ["15", "07"]]]], ["2025", 1, [["December", ["31"]]]]],
);
assert.deepEqual(groupTimelineDays([
  { date: "2026-13-01", size: 1, mtime: 1 },
  { date: "2026-02-31", size: 1, mtime: 1 },
  { date: "not-a-date", size: 1, mtime: 1 },
]), []);
const partialTimeline = groupTimelineDays([
  { date: "2026", size: 1, mtime: 1 },
  { date: "2026-08", size: 1, mtime: 1 },
  { date: "0099-01-01", size: 1, mtime: 1 },
], "en");
assert.deepEqual(
  partialTimeline.map((year) => [year.year, year.entryCount, year.entries.map((entry) => entry.label), year.months.map((month) => [month.label, month.entries.map((entry) => entry.label), month.days.map((day) => day.dayLabel)])]),
  [["2026", 2, ["Year overview"], [["August", ["Month overview"], []]]], ["0099", 1, [], [["January", [], ["01"]]]]],
);

console.log("check-memory-status: ok");
