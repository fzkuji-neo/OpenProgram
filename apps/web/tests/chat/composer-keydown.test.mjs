import assert from "node:assert/strict";
import test from "node:test";

const { useComposerKeyDown } = await import("../../components/chat/composer/input/use-composer-keydown.ts");

function keydown(init) {
  const modes = [];
  const handler = useComposerKeyDown({
    input: "hello",
    setInput() {},
    fileMention: { atToken: null, fileMatches: [], fileMenuIndex: 0, setFileMenuIndex() {}, pickFile() {}, closeMenu() {} },
    historyRecall: { historyIndex: -1, setHistoryIndex() {}, recallPrevious: () => false, recallNext() {} },
    slash: { visible: false, closing: false },
    selectSlashCommand() {},
    submit(mode) { modes.push(mode); },
  });
  let prevented = false;
  handler({
    key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
    preventDefault() { prevented = true; },
    ...init,
  });
  return { modes, prevented };
}

test("Enter adds a running message to the current turn", () => {
  assert.deepEqual(keydown({}).modes, ["steer"]);
});

test("Cmd+Enter and Ctrl+Enter queue it for the next turn", () => {
  assert.deepEqual(keydown({ metaKey: true }).modes, ["queue"]);
  assert.deepEqual(keydown({ ctrlKey: true }).modes, ["queue"]);
});

test("Shift+Enter and IME confirmation never submit", () => {
  assert.deepEqual(keydown({ shiftKey: true }).modes, []);
  assert.deepEqual(keydown({ nativeEvent: { isComposing: true, keyCode: 229 } }).modes, []);
});
