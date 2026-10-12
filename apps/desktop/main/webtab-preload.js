// Runs in every web tab, in its own isolated world: it gives the page
// nothing and reads nothing from it. Its one job is the Safari gesture: a
// pinch in on a page at its normal size opens the App's window overview.
// A pinch out magnifies the page natively (see setVisualZoomLevelLimits in
// web-views.js), and a pinch in on a magnified page only zooms it back.
const { ipcRenderer } = require("electron");

let total = 0, spent = false, startScale = 1, timer = 0;
window.addEventListener("wheel", (e) => {
  // A trackpad pinch arrives as a wheel event with ctrlKey (Control with a
  // mouse wheel zooms the same way, as in a browser).
  if (!e.isTrusted || !e.ctrlKey || e.defaultPrevented) return;
  if (!timer) startScale = window.visualViewport ? window.visualViewport.scale : 1;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = 0; total = 0; spent = false; }, 220);
  if (spent || startScale > 1.01) return;
  total += e.deltaY;
  if (total > 30) { spent = true; ipcRenderer.send("webtab:pinch-overview"); }
}, { passive: true });
