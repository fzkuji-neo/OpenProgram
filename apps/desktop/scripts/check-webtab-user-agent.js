const assert = require("node:assert/strict");
const { browserUserAgent, useBrowserUserAgent } = require("../main/webtab-user-agent");

const electron = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) openprogram-desktop/0.9.8 Chrome/138.0.7204.251 "
  + "Electron/37.10.3 Safari/537.36";
const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/138.0.7204.251 Safari/537.36";

assert.equal(browserUserAgent(electron), chrome);
assert.equal(browserUserAgent(chrome), chrome, "a plain Chrome UA is left alone");

let set = null;
const session = { getUserAgent: () => electron, setUserAgent: (value) => { set = value; } };
assert.equal(useBrowserUserAgent(session), chrome);
assert.equal(set, chrome);

console.log("webtab user agent checks passed");
