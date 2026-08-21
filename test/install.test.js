const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  assertSupportedPlatform,
  cacheName,
  downloadReleaseManifest,
  downloadUrl,
  ensureCrCompatibilityLink,
  installTool,
  manifestUrl,
  verifyAssetChecksum,
} = require("../lib/install");

test("accepts only the released Linux x64 artifact platform", () => {
  assert.doesNotThrow(() => assertSupportedPlatform("linux", "x64"));
  assert.throws(() => assertSupportedPlatform("darwin", "arm64"), /E_SETUP_PLATFORM_UNSUPPORTED/);
  assert.throws(() => assertSupportedPlatform("linux", "arm64"), /E_SETUP_PLATFORM_UNSUPPORTED/);
});

test("uses a stable per-tool cache name and release URL", () => {
  assert.equal(cacheName("calcit"), "calcit-calcit");
  assert.equal(downloadUrl("caps", "0.13.27"), "https://github.com/calcit-lang/calcit/releases/download/0.13.27/caps");
  assert.equal(
    manifestUrl("0.13.27"),
    "https://github.com/calcit-lang/calcit/releases/download/0.13.27/calcit-release-manifest.json",
  );
});

test("verifies a downloaded tool against its release manifest before caching", () => {
  const content = Buffer.from("calcit binary");
  const manifest = {
    schemaVersion: 1,
    version: "0.13.27",
    assets: [
      {
        name: "calcit",
        sha256: createHash("sha256").update(content).digest("hex"),
        size: content.length,
      },
    ],
  };
  const fileSystem = { readFileSync: () => content };
  assert.doesNotThrow(() => verifyAssetChecksum({ downloaded: "/runner/temp/calcit", assetName: "calcit", manifest, fileSystem }));
  assert.throws(
    () => verifyAssetChecksum({ downloaded: "/runner/temp/calcit", assetName: "caps", manifest, fileSystem }),
    /E_SETUP_MANIFEST_ASSET_MISSING/,
  );
  assert.throws(
    () => verifyAssetChecksum({ downloaded: "/runner/temp/calcit", assetName: "calcit", manifest: { ...manifest, assets: [{ ...manifest.assets[0], size: 1 }] }, fileSystem }),
    /E_SETUP_CHECKSUM_MISMATCH/,
  );
});

test("keeps releases without a manifest in explicit legacy compatibility mode", async () => {
  const messages = [];
  const manifest = await downloadReleaseManifest({
    version: "0.13.27",
    toolCache: { downloadTool: async () => Promise.reject({ statusCode: 404 }) },
    info: (message) => messages.push(message),
  });
  assert.equal(manifest, null);
  assert.match(messages[0], /no checksum manifest/);
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

test("verifies a cached tool before adding it to PATH", async () => {
  const content = Buffer.from("cached calcit");
  const manifest = {
    schemaVersion: 1,
    version: "0.13.27",
    assets: [{ name: "calcit", sha256: createHash("sha256").update(content).digest("hex"), size: content.length }],
  };
  const result = await installTool({
    bin: "calcit",
    version: "0.13.27",
    manifest,
    toolCache: {
      find: () => "/runner/tool-cache/calcit-calcit/0.13.27/x64",
      downloadTool: () => assert.fail("a cache hit must not download the tool"),
      cacheFile: () => assert.fail("a cache hit must not cache"),
    },
    fileSystem: { readFileSync: () => content },
  });
  assert.equal(result.cacheHit, true);
  await assert.rejects(
    installTool({
      bin: "calcit",
      version: "0.13.27",
      manifest: { ...manifest, assets: [{ ...manifest.assets[0], size: 1 }] },
      toolCache: { find: () => "/runner/tool-cache/calcit-calcit/0.13.27/x64" },
      fileSystem: { readFileSync: () => content },
    }),
    /E_SETUP_CHECKSUM_MISMATCH/,
  );
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

test("falls back to the legacy cr release asset when calcit is unavailable", async () => {
  const urls = [];
  const result = await installTool({
    bin: "calcit",
    version: "0.13.27",
    toolCache: {
      find: () => "",
      downloadTool: async (url) => {
        urls.push(url);
        if (url.endsWith("/calcit")) {
          throw { httpStatusCode: 404 };
        }
        return "/runner/temp/legacy-cr";
      },
      cacheFile: async (source, target, tool, version) => {
        assert.equal(source, "/runner/temp/legacy-cr");
        assert.equal(target, "calcit");
        assert.equal(tool, "calcit-calcit");
        assert.equal(version, "0.13.27");
        return "/runner/tool-cache/calcit-calcit/0.13.27/x64";
      },
    },
    fileSystem: { chmodSync: () => {} },
  });
  assert.deepEqual(urls, [downloadUrl("calcit", "0.13.27"), downloadUrl("cr", "0.13.27")]);
  assert.equal(result.executable, "/runner/tool-cache/calcit-calcit/0.13.27/x64/calcit");
});

test("does not mask non-404 calcit download failures with a legacy fallback", async () => {
  const urls = [];
  const failure = { httpStatusCode: 503 };

  await assert.rejects(
    installTool({
      bin: "calcit",
      version: "0.13.27",
      toolCache: {
        find: () => "",
        downloadTool: async (url) => {
          urls.push(url);
          throw failure;
        },
        cacheFile: () => assert.fail("a failed download must not be cached"),
      },
    }),
    (error) => error === failure,
  );
  assert.deepEqual(urls, [downloadUrl("calcit", "0.13.27")]);
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
