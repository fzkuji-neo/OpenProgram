// Fixed viewport screenshot lifecycle through the production IPC boundary.
module.exports = function createChecks(t) {
  async function checkPipCapture() {
    t.hooks.registerWebTabIpc();
    const win = t.fakeWindow(845);
    const ctx = t.registerContext("pip-capture", win);
    const record = t.hooks.ensureView(ctx, "pip-capture-page", "https://example.com/pip");
    const c = t.generatedNativeRecords.at(-1);
    c.controls[0].resolve();
    await record.navigation?.promise;
    const event = { sender: win.webContents };
    const capture = () => t.ipcHandlers.get("webtab:capture")(event, record.id);
    const resize = (width) => {
      t.hooks.setPipZoom(ctx, record.id, width, width * 9 / 16);
      t.hooks.syncVisibleViews(ctx, [{ id: record.id, bounds: { x: 10, y: 20, width, height: width * 9 / 16 } }]);
    };
    const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
    t.hooks.setPipZoom(ctx, record.id, 255, 146);
    t.hooks.syncVisibleViews(ctx, [{ id: record.id, bounds: { x: 10, y: 20, width: 255, height: 146 } }]);
    t.assert.deepEqual(t.plain(record.view.getBounds()), { x: 10, y: 20, width: 255, height: 143 },
      "native preview must not expose the page canvas outside the fitted rectangle");
    const fittedScale = c.nativeCalls.emulation.at(-1).scale;
    t.assert.ok(fittedScale * 1920 >= 255 && fittedScale * 1080 >= 143, "rounding must not leave an uncovered pixel");
    t.assert.ok(fittedScale * 1080 - 143 < 1, "rounding clips less than one native pixel");
    t.hooks.syncVisibleViews(ctx, [{ id: record.id, bounds: record.view.getBounds() }]);
    t.assert.deepEqual(t.plain(record.view.getBounds()), { x: 10, y: 20, width: 255, height: 143 }, "fitting is idempotent");
    resize(240);
    const emulationCount = c.nativeCalls.emulation.length;
    const zoomCount = c.nativeCalls.zoom.length;
    for (let x = 11; x <= 70; x++) {
      t.hooks.syncVisibleViews(ctx, [{ id: record.id, bounds: { x, y: 20, width: 240, height: 135 } }]);
    }
    t.assert.equal(c.nativeCalls.emulation.length, emulationCount, "60 position-only moves must not reset emulation");
    t.assert.equal(c.nativeCalls.zoom.length, zoomCount, "moving must not reset page zoom");
    const boundsCount = c.boundsCalls.length;
    for (let i = 0; i < 60; i++) {
      t.hooks.syncVisibleViews(ctx, [{ id: record.id, bounds: { x: 70, y: 20, width: 240, height: 135 } }]);
    }
    t.assert.equal(c.boundsCalls.length, boundsCount, "identical geometry must not update native bounds");
    t.assert.equal(c.nativeCalls.emulation.length, emulationCount);
    t.assert.equal(c.nativeCalls.insertedCSS.length, 1, "moving must not reinsert preview CSS");
    resize(480);
    t.assert.equal(c.nativeCalls.emulation.length, emulationCount + 1, "one emulation update per changed scale");
    resize(240);
    t.assert.equal((await t.hooks.inspectView(ctx, record.id)).input_scale, 0.125);
    c.delayDebuggerMethod("Page.captureScreenshot");
    c.delayDebuggerMethod("Target.getTargetInfo");
    const resolving = t.hooks.resolveView(ctx, record.id);
    const first = capture();
    const second = capture();
    await flush();
    t.assert.equal(c.debuggerCommands.filter(x => x.method === "Page.captureScreenshot").length, 1);
    t.assert.deepEqual(t.plain(c.debuggerCommands.find(x => x.method === "Page.captureScreenshot").params.clip), {
      x: 0, y: 0, width: 1920, height: 1080, scale: 0.5,
    });
    c.completeDebuggerMethod("Page.captureScreenshot");
    t.assert.equal(await first, "data:image/png;base64,PIP_CSS_PIXELS");
    t.assert.equal(await second, "data:image/png;base64,PIP_CSS_PIXELS");
    t.assert.equal(c.isDebuggerAttached(), true, "resolve still holds the shared debugger");
    const reapplied = c.nativeCalls.emulation.length;
    c.completeDebuggerMethod("Target.getTargetInfo");
    await resolving;
    t.assert.equal(c.isDebuggerAttached(), false);
    t.assert.ok(c.nativeCalls.emulation.length > reapplied, "the final detach reapplies the current viewport");
    t.assert.equal(c.nativeCalls.emulation.at(-1).scale, 0.125);

    for (const change of ["resize", "exit", "navigation", "ownership"]) {
      resize(240);
      c.delayDebuggerMethod("Page.captureScreenshot");
      const pending = capture();
      await flush();
      if (change === "resize") resize(960);
      if (change === "exit") t.hooks.setPipZoom(ctx, record.id, null);
      if (change === "navigation") record.navigation = { promise: Promise.resolve() };
      if (change === "ownership") record.ownerId = "another-window";
      c.completeDebuggerMethod("Page.captureScreenshot");
      t.assert.equal(await pending, null, `${change} invalidates a captured image`);
      t.assert.ok(c.debuggerCommands.some(x => x.method === "Emulation.clearDeviceMetricsOverride"));
      t.assert.equal(c.isDebuggerAttached(), false);
      if (change === "exit") t.assert.equal(record.pipLayoutZoom, null);
      if (change === "resize") t.assert.equal(c.nativeCalls.emulation.at(-1).scale, 0.5);
      record.ownerId = ctx.id;
      record.navigation = null;
    }
    resize(240);
    const send = record.view.webContents.debugger.sendCommand;
    record.view.webContents.debugger.sendCommand = (method, params) => method === "Page.captureScreenshot"
      ? Promise.reject(new Error("injected capture failure")) : send(method, params);
    t.assert.equal(await capture(), null);
    t.assert.equal(c.debuggerCommands.at(-1).method, "Emulation.clearDeviceMetricsOverride");
    t.assert.equal(c.nativeCalls.emulation.at(-1).scale, 0.125);
    t.assert.equal(c.isDebuggerAttached(), false);
    // Pending styles from either side of navigation cannot survive a preview exit.
    t.hooks.setPipZoom(ctx, record.id, null);
    await flush();
    t.assert.ok(c.nativeCalls.removedCSS.includes(c.nativeCalls.insertedCSS[0].key));
    const pendingStyles = [];
    record.view.webContents.insertCSS = () => new Promise(resolve => pendingStyles.push(resolve));
    resize(240);
    const beforeNavigation = c.nativeCalls.emulation.length;
    record.view.webContents.emit("did-navigate");
    t.assert.equal(c.nativeCalls.emulation.length, beforeNavigation + 1, "navigation forces restore even at the same scale");
    t.assert.equal(pendingStyles.length, 2);
    t.hooks.setPipZoom(ctx, record.id, null);
    pendingStyles[0]("old-document-style");
    pendingStyles[1]("new-document-style");
    await flush();
    t.assert.ok(c.nativeCalls.removedCSS.includes("old-document-style"));
    t.assert.ok(c.nativeCalls.removedCSS.includes("new-document-style"));
    t.assert.equal(record.pipScrollbarStyle, null);
    t.hooks.destroyView(ctx, record.id);
    t.hooks.windows.delete(ctx.id);
  }
  return { checkPipCapture };
};
