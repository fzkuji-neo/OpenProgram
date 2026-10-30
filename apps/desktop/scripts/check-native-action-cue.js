// The agent cursor over desktop apps: placed at the step's screen point,
// shown once per step although every App window forwards it, then hidden.
const assert = require("node:assert/strict");
const { createActionCues } = require("../main/action-cues");

const windows = [];
class FakeWindow {
  constructor(options) {
    this.options = options;
    this.bounds = null;
    this.visible = false;
    this.sent = [];
    this.webContents = { send: (channel, payload) => this.sent.push([channel, payload]) };
    windows.push(this);
  }
  setIgnoreMouseEvents() {}
  setAlwaysOnTop() {}
  on() {}
  loadURL() { return Promise.resolve(); }
  setBounds(bounds) { this.bounds = bounds; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  isDestroyed() { return false; }
}

const timers = [];
const cues = createActionCues({
  ACTION_CUE_MS: 2800,
  ACTION_CUE_SIZE: 40,
  BrowserWindow: FakeWindow,
  START_URL: "http://127.0.0.1:18100/",
  WEB_PORT: 18100,
  __dirname: __dirname,
  clearTimeout: (timer) => { if (timer) timer.cleared = true; },
  layoutControlOverlay: () => {},
  nativeTheme: { prefersReducedMotion: true },
  ownerOf: () => null,
  path: require("node:path"),
  recordFor: () => null,
  setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
});

const cue = { session_id: "s", x: 300, y: 200, sequence: 1, at: 10 };
assert.equal(cues.showNativeActionCue(cue), true);
assert.equal(windows.length, 1);
const [win] = windows;
assert.equal(win.options.focusable, false, "the cursor never takes focus");
assert.deepEqual(win.bounds, { x: 280, y: 180, width: 40, height: 40 });
assert.equal(win.visible, true);

// Two App windows forward the same step: it plays once.
assert.equal(cues.showNativeActionCue({ ...cue }), false);
assert.equal(cues.showNativeActionCue({ ...cue, x: Number.NaN, sequence: 2 }), false);

// The overlay page reports ready, then receives the cue to play.
cues.markNativeCueReady();
assert.deepEqual(win.sent.at(-1), ["webtab:action-cue", { play: "never", playSeq: 1, reducedMotion: true }]);

// After the cue time the cursor hides.
timers.filter((timer) => timer.ms === 2800 && !timer.cleared).at(-1).fn();
assert.equal(win.visible, false);
assert.equal(cues.nativeCueSender({ sender: win.webContents }), true);
// A theme change paints App windows only: a background colour on this
// transparent window would draw the cursor on an opaque tile.
const mainSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "main.js"), "utf8");
const start = mainSource.indexOf("function applyWindowChrome");
const chrome = mainSource.slice(start, mainSource.indexOf("\n}\n", start));
assert.ok(chrome.includes("setBackgroundColor") && !chrome.includes("getAllWindows"),
  "applyWindowChrome repaints the App's own windows, not the transparent overlays");
console.log("native action cue: placed, deduped, hidden and kept transparent");
