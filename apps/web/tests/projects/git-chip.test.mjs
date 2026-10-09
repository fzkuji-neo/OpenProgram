import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { parseHTML } from 'linkedom';

const webRoot = new URL('../../', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), webRoot).href
      : specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? new URL(specifier, context.parentURL).href : null;
    if (base) for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (existsSync(fileURLToPath(base + suffix))) return { url: base + suffix, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    let source;
    if (url.endsWith('/lib/i18n/index.ts')) source = 'export const useTranslation=()=>({text:(en)=>en});';
    if (url.endsWith('/components/ui/button.tsx')) source = 'export const buttonVariants=()=>"";';
    if (url.endsWith('/components/solar-icons/index.ts')) source = 'export const SolarIcon=()=>null;';
    if (url.endsWith('/lib/session-store/session-scope.tsx')) source = 'export const useOptionalScopedSessionId=()=>"s1";';
    if (url.endsWith('/lib/runtime-bridge/ui.ts')) source = 'export const closeAllPopovers=()=>{};';
    if (url.endsWith('/lib/desktop/bridge-api.ts')) source = 'export const desktopBridge=()=>({openExternal:u=>globalThis.gitOpened.push(u)});';
    if (url.endsWith('/lib/tabs/center-tabs-store.ts')) source = 'export const useCenterTabs=sel=>sel({openReviewTab:(...a)=>globalThis.gitReviews.push(a)});';
    if (url.endsWith('/components/ui/popover.tsx')) source = 'export const Popover=({children})=>children;export const PopoverTrigger=Popover;export const PopoverContent=Popover;';
    if (url.endsWith('/components/ui/tooltip.tsx')) source = 'export const HoverTip=({children})=>children;';
    if (url.endsWith('/lib/session-store/index.ts')) source = 'export const useSessionStore=sel=>sel(globalThis.gitStore);useSessionStore.getState=()=>globalThis.gitStore;';
    if (url.endsWith('/lib/net/ws-request.ts')) source = 'export const wsRequest=(...args)=>globalThis.gitRequest(...args);';
    if (source) return { format: 'module', source, shortCircuit: true };
    if (url.endsWith('.tsx')) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    }
    return next(url, context);
  },
});

const { window } = parseHTML('<html><body></body></html>');
globalThis.window = window; globalThis.document = window.document;
globalThis.Event = window.Event; globalThis.CustomEvent = window.CustomEvent; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { GitChip } = await import('../../components/chat/top-bar/git-chip.tsx');

const STATUS = {
  is_repo: true, root: '/repo', repo_name: 'repo', branch: 'feature', head: 'abc', upstream: null,
  ahead: 0, behind: 0, changes: { files: 2, untracked: 1, conflicts: 0, insertions: 3, deletions: 1 },
  is_worktree: false, default_branch: 'main', has_remote: true, gh_available: true,
  worktrees: [{ path: '/repo', branch: 'feature', is_main: true, is_current: true }],
  branches: ['feature', 'main'],
};

function setup(statusFor) {
  const calls = [];
  globalThis.gitStore = { runningTasks: {}, conversations: { s1: {} }, currentSessionId: 's1', setComposerInputFor: (k, v) => { globalThis.gitDraft = v; }, focusComposer() {}, activeChatKey: 's1' };
  globalThis.gitReviews = []; globalThis.gitOpened = [];
  globalThis.gitRequest = async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'git_folder_status') return { path: payload.path, status: { path: payload.path, ...statusFor(payload.path) } };
    if (action === 'git_switch_branch') return { path: payload.path, ok: true, status: { ...STATUS, branch: payload.branch } };
    return { path: payload.path, ok: false, error: 'nope' };
  };
  return calls;
}

async function mount(elements) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(h('div', null, ...elements)));
  await act(async () => {});
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test('one pill per checkout: a second folder in the same repository hides', async () => {
  setup(() => STATUS);
  const { host, unmount } = await mount([
    h(GitChip, { key: 'a', path: '/repo', order: 0 }),
    h(GitChip, { key: 'b', path: '/repo/sub', order: 1 }),
  ]);
  const pills = host.querySelectorAll('button.git-seg');
  assert.equal(pills.length, 1);
  assert.match(pills[0].textContent, /feature/);
  assert.match(pills[0].textContent, /\+3/);
  assert.match(pills[0].textContent, /−1/);
  await unmount();
});

test('folders outside git render nothing', async () => {
  setup(() => ({ is_repo: false }));
  const { host, unmount } = await mount([h(GitChip, { path: '/plain', order: 0 })]);
  assert.equal(host.querySelector('button.git-seg'), null);
  await unmount();
});

test('menu switches branches, opens review and hands uncommitted PRs to the agent', async () => {
  const calls = setup(() => STATUS);
  const { host, unmount } = await mount([h(GitChip, { path: '/repo', order: 0, onUseFolder: () => {} })]);
  const row = (label) => [...host.querySelectorAll('div')].find((el) => el.textContent.startsWith(label) && el.className.includes('cursor-pointer'));
  await act(async () => row('main').dispatchEvent(new Event('click', { bubbles: true })));
  assert.deepEqual(calls.find(([a]) => a === 'git_switch_branch'), ['git_switch_branch', { path: '/repo', branch: 'main', create: false }]);
  await act(async () => row('2 uncommitted files').dispatchEvent(new Event('click', { bubbles: true })));
  assert.deepEqual(globalThis.gitReviews[0], ['s1', undefined, 'workspace']);
  await act(async () => row('Commit & open PR').dispatchEvent(new Event('click', { bubbles: true })));
  assert.match(globalThis.gitDraft, /pull request/);
  await unmount();
});
