import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Dialogs drifted into several looks: the old shadcn default with a black
// 80% overlay, hand-rolled backdrops, and the browser's native confirm().
// Every modal now renders through the Nova Dialog / AlertDialog, and every
// "are you sure?" through the shared ConfirmDialog.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

function sources(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path));
    else if (/\.(tsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}
const all = [...sources("components"), ...sources("lib"), ...sources("app")];

test("Dialog and AlertDialog are Nova's: light overlay, popover surface, docs scale", () => {
  for (const file of ["components/ui/dialog.tsx", "components/ui/alert-dialog.tsx"]) {
    const source = read(file);
    assert.match(source, /z-\[110\] bg-black\/10 duration-100 supports-backdrop-filter:backdrop-blur-xs/, file);
    assert.match(source, /data-native-view-occluder="true"/, file);
    assert.match(source, /shadcn-scale fixed top-1\/2 left-1\/2 z-\[120\][^"]*rounded-xl bg-popover p-4/, file);
    assert.match(source, /-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted\/50 p-4/, file);
    assert.doesNotMatch(source, /bg-black\/80/, file);
  }
  assert.doesNotMatch(read("components/ui/command.tsx"), /<DialogOverlay className=/);
  assert.match(read("app/globals.css"), /--popover: var\(--bg-input\);/);
});

test("confirmations go through the shared ConfirmDialog, never the native confirm()", () => {
  assert.match(read("app/providers.tsx"), /<ConfirmDialogHost \/>/);
  const confirm = read("components/ui/confirm-dialog.tsx");
  assert.match(confirm, /variant=\{destructive \? "destructive" : "default"\}/);
  // A click outside cancels, like every Dialog; Radix's AlertDialog alone would ignore it.
  assert.match(confirm, /<AlertDialogContent onOverlayClick=\{onCancel\}>/);
  assert.match(read("components/ui/alert-dialog.tsx"), /<AlertDialogOverlay onClick=\{onOverlayClick\} \/>/);
  for (const file of all) {
    if (file === "components/ui/confirm-dialog.tsx") continue;
    const source = read(file);
    assert.doesNotMatch(source, /window\.confirm\(|[(!\s]confirm\(/, file);
    assert.doesNotMatch(source, /sessions-list\/confirm-dialog/, file);
  }
  const permission = read("components/chat/top-bar/permission-menu.tsx");
  assert.match(permission, /<ConfirmDialog/);
  assert.doesNotMatch(permission, /rgba\(0,0,0,0\.45\)/);
});

test("no hand-rolled modal backdrops or dialog surface overrides remain", () => {
  for (const file of all) {
    const source = read(file);
    assert.doesNotMatch(source, /dialogBackdrop|modalBackdrop|branches-merge-modal-backdrop/, file);
    if (/\.tsx$/.test(file)) {
      assert.doesNotMatch(source, /background: "rgba\(0,0,0,0\.5\)"/, file);
      // A red fill under the destructive button's red text.
      assert.doesNotMatch(source, /hover:bg-\[#c9413a\]/, file);
    }
  }
  // Dialog classes in modules size the dialog; the surface stays Nova's.
  for (const [css, cls] of [
    ["components/sidebar/project-settings.module.css", ".dialog {"],
    ["components/chat/badges/goal-chip.module.css", ".dialog {"],
    ["components/plugins/plugins.module.css", ".dialog {"],
    ["components/settings/channels/channels.module.css", ".modal {"],
    ["components/files/files-panel.module.css", ".fileDetails {"],
  ]) {
    const styles = read(css);
    const start = styles.indexOf(cls);
    assert.ok(start >= 0, `${css} ${cls}`);
    const block = styles.slice(start, styles.indexOf("}", start));
    assert.doesNotMatch(block, /background|border-radius|box-shadow|padding|border:/, `${css} ${cls}`);
  }
  const useModal = all.filter((file) => /useModalA11y\(/.test(read(file)));
  assert.deepEqual(
    useModal.map((file) => relative(".", file)).sort(),
    ["components/chat/messages/attachment-preview.tsx", "lib/hooks/use-modal-a11y.ts"].sort(),
    "only the attachment lightbox keeps the hand-rolled modal hook",
  );
});
