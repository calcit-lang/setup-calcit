const test = require("node:test");
const assert = require("node:assert/strict");

const { assertSupportedPlatform, cacheName, downloadUrl, installTool } = require("../lib/install");

test("accepts only the released Linux x64 artifact platform", () => {
  assert.doesNotThrow(() => assertSupportedPlatform("linux", "x64"));
  assert.throws(() => assertSupportedPlatform("darwin", "arm64"), /E_SETUP_PLATFORM_UNSUPPORTED/);
  assert.throws(() => assertSupportedPlatform("linux", "arm64"), /E_SETUP_PLATFORM_UNSUPPORTED/);
});

test("uses a stable per-tool cache name and release URL", () => {
  assert.equal(cacheName("cr"), "calcit-cr");
  assert.equal(downloadUrl("caps", "0.13.27"), "https://github.com/calcit-lang/calcit/releases/download/0.13.27/caps");
});

test("restores a cached tool without downloading it", async () => {
  const result = await installTool({
    bin: "cr",
    version: "0.13.27",
    toolCache: {
      find: (tool, version) => {
        assert.equal(tool, "calcit-cr");
        assert.equal(version, "0.13.27");
        return "/runner/tool-cache/calcit-cr/0.13.27/x64";
      },
      downloadTool: () => assert.fail("a cache hit must not download"),
      cacheFile: () => assert.fail("a cache hit must not cache"),
    },
  });
  assert.deepEqual(result, {
    bin: "cr",
    executable: "/runner/tool-cache/calcit-cr/0.13.27/x64/cr",
    installDir: "/runner/tool-cache/calcit-cr/0.13.27/x64",
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
