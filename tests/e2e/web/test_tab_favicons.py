from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web"
pytestmark = pytest.mark.browser

def _bundle_tabs(output: Path) -> None:
    script = r"""
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const web = process.argv[1];
const outfile = process.argv[2];
esbuild.build({
  absWorkingDir: web,
  stdin: {
    contents: [
      'export { createElement } from "react";',
      'export { createRoot } from "react-dom/client";',
      'export { BookmarkBar } from "./components/center-tabs/browser-controls.tsx";',
      'export { useCenterTabs } from "./lib/tabs/center-tabs-store.ts";',
      'export { TabItem, CompoundTabItem } from "./components/center-tabs/tab-items.tsx";',
    ].join("\n"),
    resolveDir: web,
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  globalName: "TabBundle",
  platform: "browser",
  target: "es2022",
  define: {"process.env.NODE_ENV": JSON.stringify("test")},
  jsx: "automatic",
  outfile,
  tsconfig: path.join(web, "tsconfig.json"),
  plugins: [{
    name: "css-modules",
    setup(build) {
      build.onLoad({ filter: /\.module\.css$/ }, (args) => {
        const css = fs.readFileSync(args.path, "utf8");
        const classes = {};
        for (const match of css.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes[match[1]] = match[1];
        return {
          contents:
            "const id = " + JSON.stringify(args.path) + ";\n" +
            "if (typeof document !== 'undefined' && !document.getElementById(id)) {" +
            "  const style = document.createElement('style');" +
            "  style.id = id;" +
            "  style.textContent = " + JSON.stringify(css) + ";" +
            "  document.head.appendChild(style);" +
            "}" +
            "export default " + JSON.stringify(classes) + ";",
          loader: "js",
        };
      });
      build.onLoad({ filter: /\.css$/ }, (args) => {
        if (args.path.endsWith(".module.css")) return;
        const css = fs.readFileSync(args.path, "utf8");
        return {
          contents:
            "if (typeof document !== 'undefined') {" +
            "  const style = document.createElement('style');" +
            "  style.textContent = " + JSON.stringify(css) + ";" +
            "  document.head.appendChild(style);" +
            "}",
          loader: "js",
        };
      });
    },
  }],
}).then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
"""
    result = subprocess.run(
        ["node", "-e", script, str(WEB), str(output)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)


@pytest.mark.parametrize("compound", [False, True])
def test_tab_favicons_remain_visible(tmp_path: Path, compound: bool) -> None:
    from playwright.sync_api import expect, sync_playwright

    bundle = tmp_path / "tabs.js"
    _bundle_tabs(bundle)
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch()
        try:
            page = browser.new_page()
            page.route("http://tabs.test/", lambda route: route.fulfill(body='<div id="root"></div>', content_type="text/html"))
            page.goto("http://tabs.test/")
            page.evaluate("window.process = {env: {NODE_ENV: 'test'}}")
            page.add_script_tag(path=str(bundle))
            page.evaluate("""compound => {
              const {createElement: h, createRoot, TabItem, CompoundTabItem} = TabBundle;
              const root = createRoot(document.getElementById('root'));
              window.showIcon = url => {
                const tab = {id:'web-a',kind:'web',title:'Website',url:'https://site.test/',faviconUrl:url};
                const common = {onActivate(){},onFocusTab(){},onOpenMenu(){},onClose(){},onExited(){},onDragPointerDown(){},shiftX:0};
                root.render(compound ? h(CompoundTabItem, {...common,tabs:[tab,{id:'chat-b',kind:'session',title:'Chat'}],group:{id:'group',memberIds:['web-a','chat-b'],visibleIds:['web-a','chat-b'],focusedId:'web-a'},activeId:'web-a',focusedTabId:'web-a',closingIds:new Set()}) : h(TabItem,{...common,tab,active:true,tabStop:true,closing:false}));
              };
              window.iconURL = color => 'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'+(color?'<rect width="16" height="16" fill="'+color+'"/>':'')+'</svg>');
              showIcon(iconURL(null));
            }""", compound)
            icon = page.locator('[class*="tabIcon"]').first
            expect(icon.locator('svg')).to_be_visible()
            # A loaded but transparent image must not replace the fallback.
            page.wait_for_function("!document.querySelector('[class*=tabIcon] img') || document.querySelector('[class*=tabIcon] img').complete")
            expect(icon.locator('svg')).to_be_visible()
            page.evaluate("showIcon(iconURL('red'))")
            expect(icon.locator('img')).to_be_visible()
            expect(icon.locator('svg')).to_have_count(0)
            page.evaluate("showIcon('data:image/png;base64,broken')")
            expect(icon.locator('svg')).to_be_visible()
            page.evaluate("showIcon(iconURL('blue'))")
            expect(icon.locator('img')).to_be_visible()
            expect(icon.locator('svg')).to_have_count(0)
            page.evaluate("showIcon('')")
            expect(icon.locator('svg')).to_be_visible()
        finally:
            browser.close()


def test_bookmark_bar_icons_overflow_and_all_bookmarks(tmp_path: Path) -> None:
    from playwright.sync_api import expect, sync_playwright
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread

    bundle = tmp_path / "bookmarks.js"
    _bundle_tabs(bundle)
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            is_icon = self.path == '/favicon.ico'
            if is_icon:
                requests.append(dict(self.headers))
            body = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>' if is_icon else '<div id="root"></div>').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml' if is_icon else 'text/html')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *_args):
            pass
    # Playwright intentionally aborts /favicon.ico when request routing is on.
    # Serve a real owned loopback endpoint to exercise the production URL unchanged.
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as runtime:
            browser = runtime.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 650, "height": 450})
                page.goto(base + '/')
                page.evaluate("window.process = {env: {NODE_ENV: 'test'}}")
                page.add_script_tag(path=str(bundle))
                page.evaluate("""base => {
                  const leaf = (id, title) => ({kind:'bookmark', id, title, url:base+'/'+id});
                  const root = {kind:'folder',id:'root',title:'',children:[
                    {kind:'folder',id:'bar',title:'Bookmarks bar',children:[leaf('first','Website'),
                      {kind:'folder',id:'folder',title:'Folder',children:[leaf('nested','Nested website')]},
                      ...Array.from({length:12},(_,i)=>leaf('more'+i,'Long bookmark '+i))]},
                    {kind:'folder',id:'other',title:'Other bookmarks',children:[leaf('other-site','Other website')]}
                  ]};
                  localStorage.setItem('openprogram.bookmarks', JSON.stringify({version:2,root}));
                  localStorage.setItem('agentic_locale','en');
                  window.bookmarkTree=root;
                  const {createElement:h,createRoot,BookmarkBar}=TabBundle;
                  createRoot(document.getElementById('root')).render(h(BookmarkBar,{ownerId:'test',onNavigate(url){window.navigated=url}}));
                }""", base)
                website = page.get_by_role('button', name='Website', exact=True)
                expect(website.locator('img')).to_be_visible()
                assert requests and not requests[0].get('Referer')
                more = page.get_by_role('button', name='Show hidden bookmarks', exact=True)
                all_bookmarks = page.get_by_role('button', name='All bookmarks', exact=True)
                expect(more).to_be_visible()
                expect(all_bookmarks).to_be_visible()
                assert more.bounding_box()['x'] < all_bookmarks.bounding_box()['x']
                expect(page.get_by_role('button', name='Other bookmarks', exact=True)).to_have_count(0)
                more.click()
                hidden = page.get_by_role('menuitem', name='Long bookmark 11', exact=True)
                expect(hidden.locator('img')).to_be_visible()
                hidden.click()
                assert page.evaluate('window.navigated') == base + '/more11'
                all_bookmarks.click()
                assert page.evaluate("TabBundle.useCenterTabs.getState().tabs.some(t=>t.kind==='builtin' && t.page==='bookmarks')")
                # A changed saved icon must recover; bad saved data tries the site's icon.
                page.evaluate("""() => {
                  bookmarkTree.children[0].children[0].faviconUrl='data:image/png;base64,broken';
                  localStorage.setItem('openprogram.bookmarks',JSON.stringify({version:2,root:bookmarkTree}));
                  window.dispatchEvent(new Event('openprogram:bookmarks-changed'));
                }""")
                expect(website.locator('img')).to_be_visible()
                expect(website.locator('img')).to_have_attribute('src',base + '/favicon.ico')
                page.set_viewport_size({"width":1100,"height":450})
                expect(all_bookmarks).to_be_visible()
                assert more.bounding_box()['x'] < all_bookmarks.bounding_box()['x']
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
