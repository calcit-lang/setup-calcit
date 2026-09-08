const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  parseCalcitVersion,
  resolveCapsVersion,
  resolveDepsFile,
  resolveToolOutput,
  resolveTools,
  resolveVersion,
} = require("../lib/version");

test("reads one Calcit version from deps.cirru", () => {
  assert.equal(parseCalcitVersion("{} (:calcit-version |0.14.3)"), "0.14.3");
  assert.equal(parseCalcitVersion("{} (:calcit-version 0.14.3-beta.1)"), "0.14.3-beta.1");
  assert.equal(parseCalcitVersion("{} (:dependencies {})"), null);
});

test("rejects duplicate and malformed declared versions", () => {
  assert.throws(
    () => parseCalcitVersion("{} (:calcit-version |0.14.3) (:calcit-version |0.14.4)"),
    /E_SETUP_VERSION_INVALID/,
  );
  for (const version of ["main", "01.2.3", "1.2.3-01", "1.2.3-alpha..1"]) {
    assert.throws(() => parseCalcitVersion(`{} (:calcit-version |${version})`), /E_SETUP_VERSION_INVALID/);
  }
});

test("uses deps as the normal version source and rejects conflicts", () => {
  assert.deepEqual(
    resolveVersion({ depsContent: "{} (:calcit-version |0.14.3)", depsFile: "deps.cirru", inputVersion: "" }),
    { version: "0.14.3", source: "deps-file" },
  );
  assert.deepEqual(
    resolveVersion({ depsContent: null, depsFile: "deps.cirru", inputVersion: "0.14.3" }),
    { version: "0.14.3", source: "input" },
  );
  assert.deepEqual(
    resolveVersion({ depsContent: null, depsFile: "examples/missing/deps.cirru", inputVersion: "0.14.3" }),
    { version: "0.14.3", source: "input" },
  );
  assert.throws(
    () => resolveVersion({ depsContent: "{} (:calcit-version |0.14.3)", depsFile: "deps.cirru", inputVersion: "0.14.2" }),
    /E_SETUP_VERSION_CONFLICT/,
  );
  assert.throws(
    () => resolveVersion({ depsContent: "{} (:calcit-version |main)", depsFile: "deps.cirru", inputVersion: "0.14.3" }),
    /E_SETUP_VERSION_INVALID/,
  );
});

test("confines deps-file to the workspace", () => {
  const workspace = path.join(path.sep, "tmp", "workspace");
  assert.equal(resolveDepsFile(workspace, "examples/app/deps.cirru").resolvedFile, path.join(workspace, "examples/app/deps.cirru"));
  assert.throws(() => resolveDepsFile(workspace, "../deps.cirru"), /E_SETUP_DEPS_PATH/);
});

test("resolves the independent caps release separately from Calcit", () => {
  assert.equal(resolveCapsVersion(), "0.1.1");
  assert.equal(resolveCapsVersion(""), "0.1.1");
  assert.equal(resolveCapsVersion("0.2.0-rc.1"), "0.2.0-rc.1");
  assert.throws(() => resolveCapsVersion("main"), /E_SETUP_CAPS_VERSION_INVALID/);
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
