import assert from "node:assert/strict";
import test from "node:test";

import { canMoveInto, recentMoveTargets, rememberMoveTarget, typedFolder } from "../../components/files/move-targets.ts";

test("a typed folder path is cleaned and stays inside the project", () => {
  assert.equal(typedFolder("  docs/notes/ "), "docs/notes");
  assert.equal(typedFolder("/docs//notes"), "docs/notes");
  assert.equal(typedFolder("docs\\notes"), "docs/notes");
  assert.equal(typedFolder(""), null);
  assert.equal(typedFolder("../outside"), null);
  assert.equal(typedFolder("docs/./notes"), null);
});

test("a folder never takes itself, its own inside, or the place things already are", () => {
  assert.equal(canMoveInto(["src/a.txt"], "docs"), true);
  assert.equal(canMoveInto(["src/a.txt"], ""), true);
  assert.equal(canMoveInto(["src/a.txt"], "src"), false, "already there");
  assert.equal(canMoveInto(["src/a.txt", "lib/b.txt"], "src"), true, "only some are there");
  assert.equal(canMoveInto(["src"], "src"), false);
  assert.equal(canMoveInto(["src"], "src/deep"), false);
  assert.equal(canMoveInto(["src"], "srcs"), true);
});

test("recent targets are newest first, unique and short, per project", () => {
  for (const dir of ["a", "b", "c", "a", "d", "e", "f"]) rememberMoveTarget("p1", dir);
  assert.deepEqual(recentMoveTargets("p1"), ["f", "e", "d", "a", "c"]);
  assert.deepEqual(recentMoveTargets("p2"), []);
});
