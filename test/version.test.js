const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { parseCalcitVersion, resolveDepsFile, resolveToolOutput, resolveTools, resolveVersion } = require("../lib/version");

test("reads one Calcit version from deps.cirru", () => {
  assert.equal(parseCalcitVersion("{} (:calcit-version |0.13.27)"), "0.13.27");
  assert.equal(parseCalcitVersion("{} (:calcit-version 0.13.27-beta.1)"), "0.13.27-beta.1");
  assert.equal(parseCalcitVersion("{} (:dependencies {})"), null);
});

test("rejects duplicate and malformed declared versions", () => {
  assert.throws(
    () => parseCalcitVersion("{} (:calcit-version |0.13.27) (:calcit-version |0.13.28)"),
    /E_SETUP_VERSION_INVALID/,
  );
  for (const version of ["main", "01.2.3", "1.2.3-01", "1.2.3-alpha..1"]) {
    assert.throws(() => parseCalcitVersion(`{} (:calcit-version |${version})`), /E_SETUP_VERSION_INVALID/);
  }
});

test("uses deps as the normal version source and rejects conflicts", () => {
  assert.deepEqual(
    resolveVersion({ depsContent: "{} (:calcit-version |0.13.27)", depsFile: "deps.cirru", inputVersion: "" }),
    { version: "0.13.27", source: "deps-file" },
  );
  assert.deepEqual(
    resolveVersion({ depsContent: null, depsFile: "deps.cirru", inputVersion: "0.13.27" }),
    { version: "0.13.27", source: "input" },
  );
  assert.deepEqual(
    resolveVersion({ depsContent: null, depsFile: "examples/missing/deps.cirru", inputVersion: "0.13.27" }),
    { version: "0.13.27", source: "input" },
  );
  assert.throws(
    () => resolveVersion({ depsContent: "{} (:calcit-version |0.13.27)", depsFile: "deps.cirru", inputVersion: "0.13.26" }),
    /E_SETUP_VERSION_CONFLICT/,
  );
  assert.throws(
    () => resolveVersion({ depsContent: "{} (:calcit-version |main)", depsFile: "deps.cirru", inputVersion: "0.13.27" }),
    /E_SETUP_VERSION_INVALID/,
  );
});

test("confines deps-file to the workspace", () => {
  const workspace = path.join(path.sep, "tmp", "workspace");
  assert.equal(resolveDepsFile(workspace, "examples/app/deps.cirru").resolvedFile, path.join(workspace, "examples/app/deps.cirru"));
  assert.throws(() => resolveDepsFile(workspace, "../deps.cirru"), /E_SETUP_DEPS_PATH/);
});

test("normalizes requested tools without bundler", () => {
  assert.deepEqual(resolveTools("", false), ["calcit", "caps"]);
  assert.deepEqual(resolveTools("cr,caps", false), ["calcit", "caps"]);
  assert.deepEqual(resolveTools("calcit,caps", true), ["calcit", "caps", "cr-wasm"]);
  assert.deepEqual(resolveToolOutput("", false), ["cr", "caps"]);
  assert.deepEqual(resolveToolOutput("calcit,caps", false), ["calcit", "caps"]);
  assert.throws(() => resolveTools("calcit,bundle_calcit", false), /E_SETUP_TOOL_UNKNOWN/);
  assert.throws(() => resolveTools("cr,calcit", false), /E_SETUP_TOOL_DUPLICATE/);
});
