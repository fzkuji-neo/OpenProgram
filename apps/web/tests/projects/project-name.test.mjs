import assert from "node:assert/strict";
import test from "node:test";

const { projectName } = await import("../../lib/projects/project-name.ts");

test("the home project shows the home folder's name", () => {
  const home = { name: "fzkuji", path: "/Users/fzkuji", is_default: true };
  assert.equal(projectName(home), "fzkuji");
  // A record from before the rename still reads as the folder.
  for (const old of ["System", "Default", ""]) assert.equal(projectName({ ...home, name: old }), "fzkuji");
  assert.equal(projectName({ ...home, name: "System", path: "C:\\Users\\ada\\" }), "ada");
});

test("a name the user chose, and every other project, show as named", () => {
  assert.equal(projectName({ name: "System", path: "/Users/fzkuji", is_default: true, custom_name: true }), "System");
  assert.equal(projectName({ name: "System", path: "/work/paper" }), "System");
  assert.equal(projectName({ name: "OpenProgram", path: "/work/OpenProgram" }), "OpenProgram");
});
