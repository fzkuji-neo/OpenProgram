// Websites in web tabs see the Chrome this shell is built on. The tokens
// Electron adds ("openprogram-desktop/x", "Electron/x") mark the page as an
// embedded app, which bot defenses such as Akamai treat as automation and
// answer by ending sessions an ordinary Chrome keeps.
function browserUserAgent(userAgent) {
  return String(userAgent || "")
    .replace(/\s*\bopenprogram-desktop\/\S+/gi, "")
    .replace(/\s*\bElectron\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function useBrowserUserAgent(targetSession) {
  const userAgent = browserUserAgent(targetSession.getUserAgent());
  if (userAgent) targetSession.setUserAgent(userAgent);
  return userAgent;
}

module.exports = { browserUserAgent, useBrowserUserAgent };
