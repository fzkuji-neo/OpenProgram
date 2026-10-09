"""Effort interaction and animation lifecycle through the production component."""
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / 'apps/web'
pytestmark = pytest.mark.browser


@pytest.fixture
def effort_page(tmp_path):
    from playwright.sync_api import sync_playwright

    entry = '''import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ThinkingEffortPill}from'./components/chat/composer/controls/thinking-effort-pill';
function App(){const[open,setOpen]=useState(true),[value,setValue]=useState('medium'),[fast,setFast]=useState(false),[single,setSingle]=useState(false);return <><button onClick={()=>setOpen(!open)}>Panel</button><button onClick={()=>{setSingle(!single);setValue('high')}}>Model</button><ThinkingEffortPill expanded={open} onToggle={()=>setOpen(!open)} options={single?[{value:'high',recommended:true}]:[{value:'low'},{value:'medium',recommended:true},{value:'high'},{value:'xhigh'}]} value={value} onChange={setValue} fastEnabled={fast} fastSupported={true} fastHint="Fast" toggleFast={()=>setFast(!fast)}/><output>{value}</output></>};createRoot(document.getElementById('root')).render(<App/>);'''
    bundle = tmp_path / 'effort.js'
    subprocess.run(['node', '-e', "require('esbuild').buildSync({stdin:{contents:process.argv[3],resolveDir:process.argv[1],loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},outfile:process.argv[2],tsconfig:process.argv[1]+'/tsconfig.json'});", str(WEB), str(bundle), entry], cwd=ROOT, check=True, capture_output=True)
    shell = tmp_path / 'effort.html'
    shell.write_text('<!doctype html><div id="root"></div>')
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(shell.as_uri())
        # Layout utilities for the component fixture; installed-App acceptance uses the built stylesheet.
        page.add_style_tag(content='body{--accent-purple:#a895e9;--text-muted:#888;--text-bright:#eee;--effort-thumb:white} .effort-pill-host{position:absolute;left:300px;top:220px}.effort-track{position:relative;height:20px;margin-top:20px}.effort-track>span:not(.effort-field){position:relative;display:flex;align-items:center;height:20px;width:100%}.slider-track{position:relative;width:100%;height:20px;overflow:hidden}.slider-range{position:absolute;height:100%}[role=slider]{display:block;width:16px;height:20px;position:relative}.effort-thumb{position:absolute;width:16px;height:20px;top:0;background:white;border-radius:6px}.slider-tick{position:absolute;top:50%;width:3px;height:3px;border-radius:50%}.effort-card{padding:12px;background:#222}.effort-level{display:inline-block}')
        page.add_style_tag(path=str(WEB / 'app/styles/chat/effort-pill.css'))
        page.add_script_tag(path=str(bundle))
        try:
            yield page
        finally:
            browser.close()


def test_supported_highest_effort_and_fade(effort_page):
    from playwright.sync_api import expect
    p = effort_page
    slider = p.get_by_role('slider', name='Thinking effort', exact=True)
    expect(slider).to_have_attribute('aria-valuetext', 'Medium')
    slider.press('End')
    expect(p.locator('output')).to_have_text('xhigh')
    expect(slider).to_have_attribute('aria-valuetext', 'XHigh')
    canvas = p.locator('.effort-field canvas')
    p.wait_for_function("()=>{let c=document.querySelector('.effort-field canvas');return c&&c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)}")
    first = canvas.evaluate('(c)=>c.toDataURL()')
    p.wait_for_function('(first)=>document.querySelector(".effort-field canvas").toDataURL()!==first', arg=first)
    p.get_by_role('button', name='Fast mode', exact=True).click()
    expect(p.locator('output')).to_have_text('xhigh')
    slider.press('Home')
    expect(p.locator('output')).to_have_text('low')
    p.wait_for_function("()=>{let c=document.querySelector('.effort-field canvas');return !c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)}")
    box = p.locator('.effort-track').bounding_box()
    p.mouse.click(box['x'] + box['width'] - 2, box['y'] + box['height'] / 2)
    expect(p.locator('output')).to_have_text('xhigh')
    p.get_by_role('button', name='Panel', exact=True).click()
    expect(canvas).to_have_count(0)
    p.get_by_role('button', name='Panel', exact=True).click()
    expect(slider).to_have_attribute('aria-valuetext', 'XHigh')
    p.get_by_role('button', name='Model', exact=True).click()
    expect(p.get_by_role('slider')).to_have_count(0)
    expect(p.locator('.effort-field')).to_have_count(0)


def test_reduced_motion_is_static(effort_page):
    p = effort_page
    p.emulate_media(reduced_motion='reduce')
    p.get_by_role('slider', name='Thinking effort', exact=True).press('End')
    canvas = p.locator('.effort-field canvas')
    p.wait_for_function("()=>{let c=document.querySelector('.effort-field canvas');return c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)}")
    first = canvas.evaluate('(c)=>c.toDataURL()')
    # Check stability across animation frames, not a fixed wall-clock sleep.
    p.evaluate('()=>new Promise(resolve=>{let n=0;function tick(){if(++n===12)resolve();else requestAnimationFrame(tick)}requestAnimationFrame(tick)})')
    assert canvas.evaluate('(c)=>c.toDataURL()') == first
