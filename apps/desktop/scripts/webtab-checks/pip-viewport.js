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
    t.hooks.destroyView(ctx, record.id);
    t.hooks.windows.delete(ctx.id);
  }
  return { checkPipCapture };
};
