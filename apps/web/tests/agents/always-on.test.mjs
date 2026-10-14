import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const requests = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/net/fetch-client") {
      return { url: stub(`export const jsonFetch = (url, init) => { globalThis.__alwaysOnRequests.push([url, init?.method ?? "GET"]); return Promise.resolve({}); };`), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
globalThis.__alwaysOnRequests = requests;

const alwaysOn = await import("../../lib/agents/always-on.ts");

test("wake intervals follow the server's range", () => {
  assert.equal(alwaysOn.wakeMinutesValid(5), true);
  assert.equal(alwaysOn.wakeMinutesValid(10080), true);
  assert.equal(alwaysOn.wakeMinutesValid(4), false);
  assert.equal(alwaysOn.wakeMinutesValid(10081), false);
  assert.equal(alwaysOn.wakeMinutesValid(7.5), false);
  assert.equal(alwaysOn.wakeMinutesValid(Number.NaN), false);
});

test("change signals reach listeners until they unsubscribe", () => {
  const seen = [];
  const stop = alwaysOn.onAlwaysOnChanged((id) => seen.push(id));
  alwaysOn.notifyAlwaysOnChanged("scout");
  stop();
  alwaysOn.notifyAlwaysOnChanged("scout");
  assert.deepEqual(seen, ["scout"]);
});

test("requests address the Agent's always-on endpoints", async () => {
  await alwaysOn.fetchAlwaysOn("a b");
  await alwaysOn.wakeAlwaysOn("a b");
  await alwaysOn.openAlwaysOnHome("a b");
  assert.deepEqual(requests, [
    ["/api/agents/a%20b/always-on", "GET"],
    ["/api/agents/a%20b/always-on/wake", "POST"],
    ["/api/agents/a%20b/always-on/home", "POST"],
  ]);
});
