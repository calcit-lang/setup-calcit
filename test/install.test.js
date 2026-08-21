const test = require("node:test");
const assert = require("node:assert/strict");

const { assertSupportedPlatform, cacheName, downloadUrl, ensureCrCompatibilityLink, installTool } = require("../lib/install");

test("accepts only the released Linux x64 artifact platform", () => {
  assert.doesNotThrow(() => assertSupportedPlatform("linux", "x64"));
  assert.throws(() => assertSupportedPlatform("darwin", "arm64"), /E_SETUP_PLATFORM_UNSUPPORTED/);
  assert.throws(() => assertSupportedPlatform("linux", "arm64"), /E_SETUP_PLATFORM_UNSUPPORTED/);
});

test("uses a stable per-tool cache name and release URL", () => {
  assert.equal(cacheName("calcit"), "calcit-calcit");
  assert.equal(downloadUrl("caps", "0.13.27"), "https://github.com/calcit-lang/calcit/releases/download/0.13.27/caps");
});

test("restores a cached tool without downloading it", async () => {
  const result = await installTool({
    bin: "calcit",
    version: "0.13.27",
    toolCache: {
      find: (tool, version) => {
        assert.equal(tool, "calcit-calcit");
        assert.equal(version, "0.13.27");
        return "/runner/tool-cache/calcit-calcit/0.13.27/x64";
      },
      downloadTool: () => assert.fail("a cache hit must not download"),
      cacheFile: () => assert.fail("a cache hit must not cache"),
    },
  });
  assert.deepEqual(result, {
    bin: "calcit",
    executable: "/runner/tool-cache/calcit-calcit/0.13.27/x64/calcit",
    installDir: "/runner/tool-cache/calcit-calcit/0.13.27/x64",
    cacheHit: true,
  });
});

test("downloads, caches, and marks a fresh tool executable", async () => {
  const chmodCalls = [];
  const result = await installTool({
    bin: "caps",
    version: "0.13.27",
    toolCache: {
      find: () => "",
      downloadTool: async (url) => {
        assert.equal(url, downloadUrl("caps", "0.13.27"));
        return "/runner/temp/download";
      },
      cacheFile: async (source, target, tool, version) => {
        assert.equal(source, "/runner/temp/download");
        assert.equal(target, "caps");
        assert.equal(tool, "calcit-caps");
        assert.equal(version, "0.13.27");
        return "/runner/tool-cache/calcit-caps/0.13.27/x64";
      },
    },
    fileSystem: { chmodSync: (file, mode) => chmodCalls.push([file, mode]) },
  });
  assert.equal(result.cacheHit, false);
  assert.equal(result.executable, "/runner/tool-cache/calcit-caps/0.13.27/x64/caps");
  assert.deepEqual(chmodCalls, [[result.executable, 0o755]]);
});

test("adds a relative cr compatibility link next to calcit", () => {
  const calls = [];
  const compatibilityPath = ensureCrCompatibilityLink(
    { executable: "/runner/tool-cache/calcit-calcit/0.13.27/x64/calcit", installDir: "/runner/tool-cache/calcit-calcit/0.13.27/x64" },
    {
      existsSync: () => false,
      symlinkSync: (...args) => calls.push(args),
      copyFileSync: () => assert.fail("symlink should succeed"),
      chmodSync: () => assert.fail("symlink should not need chmod"),
    },
  );
  assert.equal(compatibilityPath, "/runner/tool-cache/calcit-calcit/0.13.27/x64/cr");
  assert.deepEqual(calls, [["calcit", compatibilityPath]]);
});

test("copies calcit only when a compatibility link cannot be created", () => {
  const calls = [];
  ensureCrCompatibilityLink(
    { executable: "/runner/tool-cache/calcit-calcit/0.13.27/x64/calcit", installDir: "/runner/tool-cache/calcit-calcit/0.13.27/x64" },
    {
      existsSync: () => false,
      symlinkSync: () => {
        throw new Error("link unavailable");
      },
      copyFileSync: (...args) => calls.push(["copy", ...args]),
      chmodSync: (...args) => calls.push(["chmod", ...args]),
    },
  );
  assert.deepEqual(calls, [
    ["copy", "/runner/tool-cache/calcit-calcit/0.13.27/x64/calcit", "/runner/tool-cache/calcit-calcit/0.13.27/x64/cr"],
    ["chmod", "/runner/tool-cache/calcit-calcit/0.13.27/x64/cr", 0o755],
  ]);
});
