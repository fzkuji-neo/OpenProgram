import assert from "node:assert/strict";
import fs from "node:fs";

import { historyPresentation } from "../../components/chat/messages/turn-files-history-state.ts";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const card = read("components/chat/messages/turn-files-chips.tsx");
const cardPresentation = read("components/chat/messages/turn-files-presentation.ts");
const bubble = read("components/chat/messages/assistant-bubble.tsx");
const rail = read("components/chat/messages/message-rail.tsx");
const review = read("components/center-tabs/review-tab-pane.tsx");
const reviewScope = read("components/center-tabs/use-review-scope.ts");
const reviewDiff = read("components/center-tabs/use-review-diff.ts");
const reviewProtocol = review + reviewScope + reviewDiff;
const store = read("lib/tabs/store/pages.ts");
const reviewLayout = read("lib/tabs/review-tab-layout.ts");
const cardCss = read("app/styles/chat/turn-files-card.css");
const design = read("../../docs/reference/design/ui/chat-turn-visual-spec.html");

assert.match(card, /if \(embedded\) \{\s*setFiles\(embedded\);/);
assert.match(card, /"review_scope"/);
assert.doesNotMatch(card, /"list_turn_files"/);
assert.match(card, /dispatchLegacyLoad\(\{ type: "resolved", ok: false \}\)/);
assert.match(card, /Could not load file changes\./);
assert.match(card, /Retry/);
assert.doesNotMatch(card, /File summary unavailable\./);
assert.match(bubble, /shouldRenderTurnFiles\(msg\.turnFiles, msg\.blocks\)/);
assert.match(rail, /shouldRenderTurnFiles\(/);
assert.match(bubble, /<TurnFilesChips\s+key=\{msg\.id\}/);
assert.match(rail, /<TurnFilesChips\s+key=\{assistantId\}/);
assert.match(bubble, /summary=\{msg\.turnFiles\}/);
assert.match(rail, /summary=\{assistantTurnFiles\}/);
assert.doesNotMatch(card, /turn_file_diff|UnifiedDiff|aria-expanded/);
assert.match(card, /name="pen-new-square"/);
assert.match(card, /name="fa-rotate-left"/);
assert.match(card, /name="fa-eye"/);
assert.match(card, /text\("Undo"/);
assert.match(card, /text\("Redo"/);
assert.match(card, /openReviewTab/);
assert.match(card, /IntersectionObserver/);
assert.match(cardPresentation, /export const TURN_FILES_MAX_CARD_FILES = 20;/);
assert.match(card, /turnFilesListLayout\(files\.length, fileCount, showAll\)/);
assert.match(card, /turnFilesSummaryComplete\(/);
assert.match(card, /className="turn-files-row turn-files-overflow"[\s\S]*?openReviewTab\(sessionId, assistantMsgId, "turn"\)/);
assert.match(card, /<FileTypeIcon name=\{file\.path\} size=\{15\} \/>/);
assert.doesNotMatch(card, /name="file-text"/);
assert.doesNotMatch(card, /files\.length > COLLAPSE_AFTER/);
assert.doesNotMatch(card, /list_turn_files|function loadMore\(\)/);
assert.match(card, /wsRequest[\s\S]*"turn_history_state"/);
assert.match(card, /operation: null,[\s\S]*?setHistoryNonce/);
assert.match(card, /setHistoryError\(""\);\s*setHistoryState\(/);
assert.match(card, /\} = historyPresentation\([\s\S]*?historyState,[\s\S]*?historyError,[\s\S]*?Review remains available/);
const refreshed = historyPresentation(
  { status: "ready", operation: "undo" },
  "",
  "fallback",
);
assert.deepEqual(refreshed, { notice: "", operation: "undo" });
const blocked = historyPresentation(
  { status: "blocked", operation: null, error: "current file state does not match the recorded source" },
  "",
  "fallback",
);
assert.deepEqual(blocked, {
  notice: "current file state does not match the recorded source",
  operation: null,
});
assert.match(card, /\{currentAction \? \([\s\S]*?<\/button>\s*\) : historyNotice \? \([\s\S]*?className="turn-files-history-notice"[\s\S]*?title=\{historyNotice\}[\s\S]*?role="status"[\s\S]*?\{historyNotice\}[\s\S]*?\) : null\}\s*<button[\s\S]*?"turn-files-review"\)/);
assert.match(card, /buttonVariants\(\{ variant: "elevated", size: "sm" \}\), "turn-files-action"/);
assert.match(card, /buttonVariants\(\{ variant: "elevated", size: "sm" \}\), "turn-files-review"/);
assert.doesNotMatch(card, /turn-files-blocked/);
assert.match(card, /updateMessage\(sessionId, assistantMsgId/);
assert.match(card, /turn-files-history-changed/);
assert.match(review, /turn-files-history-changed/);
assert.doesNotMatch(card, /Code \{codeCount\}|Tests \{testCount\}/);
assert.match(store, /openReviewTab:/);
assert.match(reviewLayout, /reviewTabId\(sessionId, assistantMsgId\)/);
assert.match(reviewLayout, /groupCenterTabs/);
assert.equal((review.match(/<UnifiedDiff/g) ?? []).length, 1);
assert.match(review, /data-mounted-diff-count=\{selectedPath \? "1" : "0"\}/);
assert.match(reviewProtocol, /limit: 100/);
assert.match(reviewProtocol, /wsRequest/);
assert.match(reviewProtocol, /snapshotId: scopeState\.snapshot_id/);
assert.match(reviewProtocol, /wsRequest[\s\S]*"review_scope"/);
assert.match(reviewProtocol, /wsRequest[\s\S]*"review_file_diff"/);
assert.match(review, /data\.status === "stale" \|\| data\.error === "STALE_SNAPSHOT"/);
assert.match(review, /clearReviewForStale/);
assert.match(review, /staleRecoveryRef/);
assert.match(review, /setRefreshNonce\(\(value\) => value \+ 1\)/);
assert.match(review, /setSelectedPath\(""\);\s*setFileCursor\(null\);\s*setDiffCursor\(null\);\s*setDiffHistory\(\[\]\)/);
assert.match(review, /status: "stale"/);
assert.match(review, /data\.error === "STALE_CURSOR"/);
assert.match(review, /diffCursorRecoveryRef/);
assert.match(review, /data\.error === "STALE_CURSOR"[\s\S]*?setDiffCursor\(null\);\s*setDiffHistory\(\[\]\)/);
assert.match(reviewProtocol, /TIMEOUT_MS/);
assert.doesNotMatch(review, /getSocket|registerWsRequest|socket\.send/);
assert.doesNotMatch(review, /queryInput|sortSelect|<input[\s\S]*Filter files|<select[\s\S]*Sort files/);
assert.match(cardCss, /\.turn-files-card\{container:turn-files\/inline-size/);
assert.match(cardCss, /\.turn-files-card\{[^}]*font-family:var\(--font-sans\)/);
assert.match(cardCss, /\.turn-files-card\{[^}]*border-radius:16px;background:var\(--bg-input\);box-shadow:var\(--composer-shadow-focus\)/);
assert.doesNotMatch(cardCss, /\.turn-files-card\{[^}]*border:1px/);
// The card always wears the deeper composer shadow; hover does not change it.
assert.match(cardCss, /\.turn-files-card\{[^}]*box-shadow:var\(--composer-shadow-focus\)/);
assert.doesNotMatch(cardCss, /\.turn-files-card:hover\{[^}]*box-shadow/);
assert.match(cardCss, /\.turn-files-summary\{[^}]*gap:10px/);
assert.match(cardCss, /\.turn-files-logo\{width:18px;height:18px/);
assert.match(cardCss, /\.turn-files-heading\{[^}]*align-items:center/);
assert.match(cardCss, /\.turn-files-heading\{[^}]*gap:8px/);
assert.match(cardCss, /\.turn-files-summary-actions\{margin-left:auto/);
assert.doesNotMatch(cardCss, /\.turn-files-meter/);
assert.match(cardCss, /\.turn-files-list\{padding:3px;border-radius:11px;background:var\(--bg-primary\)/);
assert.match(cardCss, /\.turn-files-row\{[^}]*height:30px[^}]*grid-template-columns:auto minmax\(0,1fr\) max-content[^}]*column-gap:8px/);
assert.match(cardCss, /\.turn-files-row\{[^}]*background:transparent/);
assert.match(cardCss, /\.turn-files-row:hover\{[^}]*background:var\(--bg-hover\)/);
assert.match(cardCss, /\.turn-files-diff\{display:inline-flex[^}]*border-radius:6px[^}]*overflow:hidden/);
assert.match(cardCss, /\.turn-files-stat\.is-add\{[^}]*background:color-mix\(in oklch,var\(--accent-green\)/);
assert.match(cardCss, /\.turn-files-stat\.is-del\{[^}]*background:color-mix\(in oklch,var\(--accent-red\)/);
assert.match(cardCss, /\.turn-files-name\{[^}]*font-size:13px/);
assert.match(cardCss, /\.turn-files-dir\{color:var\(--text-muted\)\}\.turn-files-base\{color:var\(--text-bright\)\}/);
assert.match(cardCss, /\.turn-files-stat\{[^}]*font-size:12px[^}]*font-variant-numeric:tabular-nums/);
assert.doesNotMatch(cardCss, /\.turn-files-name\{[^}]*var\(--font-mono\)/);
assert.doesNotMatch(cardCss, /\.turn-files-stat\{[^}]*var\(--font-mono\)/);
assert.doesNotMatch(cardCss, /\.turn-files-op\{[^}]*var\(--font-mono\)/);
assert.match(cardCss, /\.turn-files-more\{[^}]*background:transparent[^}]*font-size:13px/);
assert.match(cardCss, /\.turn-files-more:hover\{[^}]*background:var\(--bg-hover\)/);
assert.match(cardCss, /\.turn-files-history-notice\{display:block;min-width:0;max-width:min\(48ch,40cqi\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var\(--accent-orange\);font-size:12px;line-height:1\.2\}/);
assert.doesNotMatch(cardCss, /\.turn-files-blocked/);
assert.doesNotMatch(cardCss, /data-theme-mode="light"[^}]*\.turn-files-card/);
assert.match(cardCss, /@media\(max-width:420px\)\{\.turn-files-summary\{gap:6px;padding-left:6px\}\.turn-files-heading\{gap:5px\}/);
assert.match(cardCss, /@container turn-files \(max-width:420px\)\{\.turn-files-summary\{gap:6px;padding-left:6px\}\.turn-files-heading\{gap:5px\}/);
assert.match(cardCss, /@media\(max-width:420px\)[^\n]*\.turn-files-history-notice\{max-width:92px\}/);
assert.match(cardCss, /@container turn-files \(max-width:420px\)[^\n]*\.turn-files-history-notice\{max-width:92px\}/);
assert.doesNotMatch(card, /Review all \$\{fileCount\} files|审阅全部 \$\{fileCount\} 个文件/);
assert.match(design, /\.change-card-demo\{container:change-card\/inline-size/);
assert.match(design, /\.change-card-demo\{[^}]*font-family:var\(--font-sans\)/);
assert.match(design, /\.change-card-demo\{[^}]*border-radius:16px;background:var\(--bg-tertiary\);box-shadow:/);
assert.match(design, /\.change-summary\{[^}]*gap:10px/);
assert.match(design, /@media\(max-width:420px\)\{\.change-summary\{gap:6px;padding-left:6px\}/);
assert.match(design, /@container change-card \(max-width:420px\)\{\.change-summary\{gap:6px;padding-left:6px\}/);
assert.match(design, /\.change-summary-stat\{[^}]*font:12px[^}]*var\(--font-sans\)[^}]*font-variant-numeric:tabular-nums/);
assert.doesNotMatch(design, /change-summary-meter/);
assert.match(design, /\.change-summary-actions\{[^}]*margin-left:auto/);
assert.match(design, /\.change-group\{padding:3px;border-radius:11px;background:var\(--bg-primary\)/);
assert.match(design, /\.change-row\{height:30px[^}]*padding:0 10px/);
assert.match(design, /\.change-row-name\{[^}]*font:13px[^}]*var\(--font-sans\)/);
assert.match(design, /\.change-row-counts\{[^}]*grid-template-columns:max-content max-content[^}]*column-gap:6px[^}]*font:12px[^}]*var\(--font-sans\)[^}]*font-variant-numeric:tabular-nums/);
assert.match(design, /<button class="change-collapse" type="button">Collapse<\/button>/);
assert.match(design, /\.change-collapse\{[^}]*background:transparent[^}]*font:13px/);
assert.match(design, /\.change-collapse:hover\{[^}]*background:var\(--bg-hover\)/);
assert.match(design, /\.change-summary-notice\{display:block;min-width:0;max-width:min\(48ch,40cqi\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var\(--accent-orange\);font:12px\/1\.2 var\(--font-sans\)\}/);
assert.match(design, /<span class="change-summary-actions"><span class="change-summary-notice" title="current file state does not match the recorded source" role="status">current file state does not match the recorded source<\/span><button class="change-summary-action primary" type="button">Review<\/button><\/span>/);
assert.doesNotMatch(design, /<span class="change-summary-actions"><button class="change-summary-action"[^>]*>[\s\S]*?<span>Undo<\/span>/);
assert.doesNotMatch(design, /data-theme-mode="light"[^}]*\.change-card-demo/);
assert.doesNotMatch(
  cardCss,
  /@media\(max-width:420px\)[\s\S]*?turn-files-logo[^}]*?(?:width|height):17px/,
);

console.log("check-review-ui: ok");
