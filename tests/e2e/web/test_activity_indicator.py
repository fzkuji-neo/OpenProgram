from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web"
pytestmark = pytest.mark.browser


def test_activity_motion_geometry_and_accessibility(tmp_path: Path) -> None:
    from playwright.sync_api import expect, sync_playwright

    bundle = tmp_path / "activity.js"
    subprocess.run([
        "node", "-e", """
const esbuild = require('esbuild');
esbuild.buildSync({absWorkingDir:process.argv[1], stdin:{contents:
  'export {createElement} from "react"; export {createRoot} from "react-dom/client"; export {ActivityIndicator} from "./components/chat/messages/activity-indicator.tsx";',
  resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',globalName:'ActivityBundle',jsx:'automatic',outfile:process.argv[2]});
""", str(WEB), str(bundle),
    ], cwd=ROOT, check=True, capture_output=True, text=True)
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch()
        try:
            page = browser.new_page()
            page.route("http://activity.test/", lambda route: route.fulfill(
                body='<div id="root"></div>', content_type="text/html"))
            page.goto("http://activity.test/")
            page.add_style_tag(path=str(WEB / "app/styles/base.css"))
            page.add_style_tag(path=str(WEB / "app/styles/chat/thinking-spinner.css"))
            page.add_style_tag(content=":root{--accent-blue:#4989ef;--accent-purple:#a36cef} #root{display:flex;gap:24px}")
            page.add_script_tag(path=str(bundle))
            page.evaluate("""() => {
              const {createRoot,createElement:h,ActivityIndicator} = ActivityBundle;
              window.root = createRoot(document.getElementById('root'));
              window.show = phases => root.render(phases.map(phase => h(ActivityIndicator,{key:phase,phase})));
              window.seek = time => document.getAnimations().forEach(a => {a.pause();a.currentTime=time;});
              show(['thinking','tool','generating']);
            }""")
            expect(page.locator('.activity-indicator')).to_have_count(3)
            page.evaluate("seek(0)")
            boxes = page.locator('.activity-indicator').evaluate_all("els => els.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,hidden:e.getAttribute('aria-hidden')}))")
            assert boxes == [{"w": 18, "h": 18, "hidden": "true"}] * 3
            assert page.locator('linearGradient').evaluate_all("els=>new Set(els.map(e=>e.id)).size") == 3
            outer = page.locator('.activity-thinking .activity-outer').first
            inner = page.locator('.activity-thinking .activity-inner').first
            geometry = "e=>{const s=getComputedStyle(e);return [parseFloat(s.r),parseFloat(s.strokeWidth)]}"
            page.evaluate("seek(900)")
            assert outer.evaluate(geometry) == pytest.approx([7.95, 1.75])
            assert inner.evaluate(geometry) == pytest.approx([1.9, .65])
            page.evaluate("seek(2700)")
            assert outer.evaluate(geometry) == pytest.approx([5.85, .75])
            assert inner.evaluate(geometry) == pytest.approx([3.8, 1.65])
            tool = page.locator('.activity-tool .activity-outer')
            shapes = []
            for time in [0, 1200, 2400]:
                page.evaluate("time => seek(time)", time)
                shapes.append(tool.evaluate("e=>getComputedStyle(e).d"))
                # Each contour remains open: endpoints stay separated throughout morphs.
                assert tool.evaluate("e=>{const l=e.getTotalLength(),a=e.getPointAtLength(0),b=e.getPointAtLength(l);return Math.hypot(a.x-b.x,a.y-b.y)}") > 2
            assert len(set(shapes)) == 3
            orbit = page.locator('.activity-tool-orbit')
            page.evaluate("seek(1800)")
            assert orbit.evaluate("e=>getComputedStyle(e).transform") != "none"
            page.evaluate("seek(2100)")
            assert orbit.evaluate("e=>getComputedStyle(e).transform") != page.evaluate("""() => {
              seek(1800);return getComputedStyle(document.querySelector('.activity-tool-orbit')).transform;
            }""")
            arcs = page.locator('.activity-generating .activity-outer').first
            page.evaluate("seek(450)")
            long_arc = arcs.evaluate("e=>getComputedStyle(e).strokeDasharray")
            page.evaluate("seek(1350)")
            assert arcs.evaluate("e=>getComputedStyle(e).strokeDasharray") != long_arc
            assert page.locator('.activity-indicator').evaluate_all("els=>els.every(e=>e.getBoundingClientRect().width===18&&e.getBoundingClientRect().height===18)")
            for color in ['rgb(20, 60, 180)', 'rgb(210, 110, 60)']:
                page.evaluate("color=>document.documentElement.style.setProperty('--accent-blue',color)", color)
                assert page.locator('.activity-color-start').first.evaluate("e=>getComputedStyle(e).stopColor") == color
            # Remove the manually paused test animations before testing native media behavior.
            page.evaluate("show([])")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            page.emulate_media(reduced_motion="reduce")
            page.evaluate("show(['thinking','tool','generating'])")
            expect(page.locator('.activity-indicator')).to_have_count(3)
            assert page.locator('.activity-indicator').evaluate_all("els=>els.every(e=>e.getAnimations({subtree:true}).length===0)")
            assert outer.evaluate("e=>getComputedStyle(e).animationName") == 'none'
            assert outer.evaluate(geometry) == pytest.approx([6.9, 1.25])
            page.emulate_media(forced_colors="active")
            page.wait_for_function("!getComputedStyle(document.querySelector('.activity-tool .activity-outer')).stroke.startsWith('url(')")
            assert tool.evaluate("e=>getComputedStyle(e).stroke") != 'none'
            assert not tool.evaluate("e=>getComputedStyle(e).stroke").startswith('url(')
            page.emulate_media(reduced_motion="no-preference", forced_colors="none")
            page.evaluate("show(['tool'])")
            expect(page.locator('[data-activity-phase="tool"]')).to_have_count(1)
            expect(page.locator('[data-activity-phase="thinking"]')).to_have_count(0)
            page.evaluate("root.unmount()")
            expect(page.locator('.activity-indicator')).to_have_count(0)
            assert page.evaluate("document.getAnimations().length") == 0
        finally:
            browser.close()
