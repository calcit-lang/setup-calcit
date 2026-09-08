const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  assertSupportedPlatform,
  capsDownloadUrl,
  capsManifestUrl,
  cacheName,
  downloadCapsReleaseManifest,
  downloadReleaseManifest,
  downloadUrl,
  ensureCrCompatibilityLink,
  installStandaloneCaps,
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
  assert.equal(downloadUrl("caps", "0.14.3"), "https://github.com/calcit-lang/calcit/releases/download/0.14.3/caps");
  assert.equal(
    manifestUrl("0.14.3"),
    "https://github.com/calcit-lang/calcit/releases/download/0.14.3/calcit-release-manifest.json",
  );
  assert.equal(capsDownloadUrl("caps", "0.1.1"), "https://github.com/calcit-lang/caps/releases/download/0.1.1/caps");
  assert.equal(
    capsManifestUrl("0.1.1"),
    "https://github.com/calcit-lang/caps/releases/download/0.1.1/caps-release-manifest.json",
  );
});

test("downloads and validates the independent caps release manifest", async () => {
  const manifest = {
    schemaVersion: 1,
    version: "0.1.1",
    assets: [{ name: "caps", sha256: "a".repeat(64), size: 123 }],
  };
  const result = await downloadCapsReleaseManifest({
    version: "0.1.1",
    toolCache: {
      downloadTool: async (url) => {
        assert.equal(url, capsManifestUrl("0.1.1"));
        return "/runner/temp/caps-manifest";
      },
    },
    fileSystem: { readFileSync: () => JSON.stringify(manifest) },
  });
  assert.deepEqual(result, manifest);
});

test("rejects malformed JSON in the independent caps release manifest", async () => {
  await assert.rejects(
    downloadCapsReleaseManifest({
      version: "0.1.1",
      toolCache: { downloadTool: async () => "/runner/temp/caps-manifest" },
      fileSystem: { readFileSync: () => "not valid JSON" },
    }),
    /E_SETUP_CAPS_MANIFEST_INVALID: malformed release manifest for 0\.1\.1/,
  );
});

test("rejects a null independent caps release manifest with the documented error", async () => {
  await assert.rejects(
    downloadCapsReleaseManifest({
      version: "0.1.1",
      toolCache: { downloadTool: async () => "/runner/temp/caps-manifest" },
      fileSystem: { readFileSync: () => "null" },
    }),
    /E_SETUP_CAPS_MANIFEST_INVALID: malformed release manifest for 0\.1\.1/,
  );
});

test("rejects an independent caps manifest that omits the binary", async () => {
  await assert.rejects(
    downloadCapsReleaseManifest({
      version: "0.1.1",
      toolCache: { downloadTool: async () => "/runner/temp/caps-manifest" },
      fileSystem: { readFileSync: () => JSON.stringify({ schemaVersion: 1, version: "0.1.1", assets: [] }) },
    }).then((manifest) => verifyAssetChecksum({ downloaded: "/runner/temp/caps", assetName: "caps", manifest })),
    /E_SETUP_MANIFEST_ASSET_MISSING/,
  );
});

test("verifies a downloaded tool against its release manifest before caching", () => {
  const content = Buffer.from("calcit binary");
  const manifest = {
    schemaVersion: 1,
    version: "0.14.3",
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
    version: "0.14.3",
    toolCache: { downloadTool: async () => Promise.reject({ statusCode: 404 }) },
    info: (message) => messages.push(message),
  });
  assert.equal(manifest, null);
  assert.match(messages[0], /no checksum manifest/);
});

test("reports malformed manifest JSON with the setup error prefix", async () => {
  await assert.rejects(
    downloadReleaseManifest({
      version: "0.14.3",
      toolCache: { downloadTool: async () => "/runner/temp/manifest" },
      fileSystem: { readFileSync: () => "not valid JSON" },
    }),
    /E_SETUP_MANIFEST_INVALID: malformed release manifest for 0\.14\.3/,
  );
});

test("rejects manifest assets with an invalid size", async () => {
  const manifest = JSON.stringify({
    schemaVersion: 1,
    version: "0.14.3",
    assets: [{ name: "calcit", sha256: "a".repeat(64), size: -1 }],
  });
  await assert.rejects(
    downloadReleaseManifest({
      version: "0.14.3",
      toolCache: { downloadTool: async () => "/runner/temp/manifest" },
      fileSystem: { readFileSync: () => manifest },
    }),
    /E_SETUP_MANIFEST_INVALID: malformed asset record/,
  );
});

test("restores a cached tool without downloading it", async () => {
  const result = await installTool({
    bin: "calcit",
    version: "0.14.3",
    toolCache: {
      find: (tool, version) => {
        assert.equal(tool, "calcit-calcit");
        assert.equal(version, "0.14.3");
        return "/runner/tool-cache/calcit-calcit/0.14.3/x64";
      },
      downloadTool: () => assert.fail("a cache hit must not download"),
      cacheFile: () => assert.fail("a cache hit must not cache"),
    },
  });
  assert.deepEqual(result, {
    bin: "calcit",
    executable: "/runner/tool-cache/calcit-calcit/0.14.3/x64/calcit",
    installDir: "/runner/tool-cache/calcit-calcit/0.14.3/x64",
    cacheHit: true,
  });
});

test("verifies a cached tool before adding it to PATH", async () => {
  const content = Buffer.from("cached calcit");
  const manifest = {
    schemaVersion: 1,
    version: "0.14.3",
    assets: [{ name: "calcit", sha256: createHash("sha256").update(content).digest("hex"), size: content.length }],
  };
  const result = await installTool({
    bin: "calcit",
    version: "0.14.3",
    manifest,
    toolCache: {
      find: () => "/runner/tool-cache/calcit-calcit/0.14.3/x64",
      downloadTool: () => assert.fail("a cache hit must not download the tool"),
      cacheFile: () => assert.fail("a cache hit must not cache"),
    },
    fileSystem: { readFileSync: () => content },
  });
  assert.equal(result.cacheHit, true);
  await assert.rejects(
    installTool({
      bin: "calcit",
      version: "0.14.3",
      manifest: { ...manifest, assets: [{ ...manifest.assets[0], size: 1 }] },
      toolCache: { find: () => "/runner/tool-cache/calcit-calcit/0.14.3/x64" },
      fileSystem: { readFileSync: () => content },
    }),
    /E_SETUP_CHECKSUM_MISMATCH/,
  );
});

test("downloads, caches, and marks a fresh tool executable", async () => {
  const chmodCalls = [];
  const result = await installTool({
    bin: "caps",
    version: "0.14.3",
    toolCache: {
      find: () => "",
      downloadTool: async (url) => {
        assert.equal(url, downloadUrl("caps", "0.14.3"));
        return "/runner/temp/download";
      },
      cacheFile: async (source, target, tool, version) => {
        assert.equal(source, "/runner/temp/download");
        assert.equal(target, "caps");
        assert.equal(tool, "calcit-caps");
        assert.equal(version, "0.14.3");
        return "/runner/tool-cache/calcit-caps/0.14.3/x64";
      },
    },
    fileSystem: { chmodSync: (file, mode) => chmodCalls.push([file, mode]) },
  });
  assert.equal(result.cacheHit, false);
  assert.equal(result.executable, "/runner/tool-cache/calcit-caps/0.14.3/x64/caps");
  assert.deepEqual(chmodCalls, [[result.executable, 0o755]]);
});

test("restores the independent caps release from its own versioned cache", async () => {
  const content = Buffer.from("cached caps");
  const manifest = {
    schemaVersion: 1,
    version: "0.1.1",
    assets: [{ name: "caps", sha256: createHash("sha256").update(content).digest("hex"), size: content.length }],
  };
  const result = await installStandaloneCaps({
    version: "0.1.1",
    manifest,
    toolCache: {
      find: (tool, version) => {
        assert.equal(tool, "calcit-caps");
        assert.equal(version, "0.1.1");
        return "/runner/tool-cache/calcit-caps/0.1.1/x64";
      },
      downloadTool: () => assert.fail("a cache hit must not download the binary"),
      cacheFile: () => assert.fail("a cache hit must not cache"),
    },
    fileSystem: { readFileSync: () => content },
  });
  assert.deepEqual(result, {
    bin: "caps",
    executable: "/runner/tool-cache/calcit-caps/0.1.1/x64/caps",
    installDir: "/runner/tool-cache/calcit-caps/0.1.1/x64",
    cacheHit: true,
  });
});

test("downloads, verifies, and caches the independent caps release binary", async () => {
  const calls = [];
  const content = Buffer.from("downloaded caps");
  const manifest = {
    schemaVersion: 1,
    version: "0.1.1",
    assets: [{ name: "caps", sha256: createHash("sha256").update(content).digest("hex"), size: content.length }],
  };
  const result = await installStandaloneCaps({
    version: "0.1.1",
    manifest,
    toolCache: {
      find: () => "",
      downloadTool: async (url) => {
        calls.push(["download", url]);
        return "/runner/temp/caps";
      },
      cacheFile: async (source, target, tool, version) => {
        calls.push(["cache", source, target, tool, version]);
        return "/runner/tool-cache/calcit-caps/0.1.1/x64";
      },
    },
    fileSystem: {
      readFileSync: (file) => {
        assert.equal(file, "/runner/temp/caps");
        return content;
      },
      chmodSync: (file, mode) => calls.push(["chmod", file, mode]),
    },
  });

  assert.deepEqual(calls, [
    ["download", capsDownloadUrl("caps", "0.1.1")],
    ["cache", "/runner/temp/caps", "caps", "calcit-caps", "0.1.1"],
    ["chmod", "/runner/tool-cache/calcit-caps/0.1.1/x64/caps", 0o755],
  ]);
  assert.deepEqual(result, {
    bin: "caps",
    executable: "/runner/tool-cache/calcit-caps/0.1.1/x64/caps",
    installDir: "/runner/tool-cache/calcit-caps/0.1.1/x64",
    cacheHit: false,
  });
});

test("rejects an independent caps binary with a mismatched checksum", async () => {
  await assert.rejects(
    installStandaloneCaps({
      version: "0.1.1",
      manifest: {
        schemaVersion: 1,
        version: "0.1.1",
        assets: [{ name: "caps", sha256: "a".repeat(64), size: 1 }],
      },
      toolCache: {
        find: () => "",
        downloadTool: async () => "/runner/temp/caps",
        cacheFile: () => assert.fail("a mismatched executable must not be cached"),
      },
      fileSystem: { readFileSync: () => Buffer.from("not the published caps") },
    }),
    /E_SETUP_CHECKSUM_MISMATCH/,
  );
});

test("falls back to the legacy cr release asset when calcit is unavailable", async () => {
  const urls = [];
  const result = await installTool({
    bin: "calcit",
    version: "0.14.3",
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
        assert.equal(version, "0.14.3");
        return "/runner/tool-cache/calcit-calcit/0.14.3/x64";
      },
    },
    fileSystem: { chmodSync: () => {} },
  });
  assert.deepEqual(urls, [downloadUrl("calcit", "0.14.3"), downloadUrl("cr", "0.14.3")]);
  assert.equal(result.executable, "/runner/tool-cache/calcit-calcit/0.14.3/x64/calcit");
});

test("does not mask non-404 calcit download failures with a legacy fallback", async () => {
  const urls = [];
  const failure = { httpStatusCode: 503 };

  await assert.rejects(
    installTool({
      bin: "calcit",
      version: "0.14.3",
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
  assert.deepEqual(urls, [downloadUrl("calcit", "0.14.3")]);
});

test("adds a relative cr compatibility link next to calcit", () => {
  const calls = [];
  const compatibilityPath = ensureCrCompatibilityLink(
    { executable: "/runner/tool-cache/calcit-calcit/0.14.3/x64/calcit", installDir: "/runner/tool-cache/calcit-calcit/0.14.3/x64" },
    {
      existsSync: () => false,
      symlinkSync: (...args) => calls.push(args),
      copyFileSync: () => assert.fail("symlink should succeed"),
      chmodSync: () => assert.fail("symlink should not need chmod"),
    },
  );
  assert.equal(compatibilityPath, "/runner/tool-cache/calcit-calcit/0.14.3/x64/cr");
  assert.deepEqual(calls, [["calcit", compatibilityPath]]);
});

test("copies calcit only when a compatibility link cannot be created", () => {
  const calls = [];
  ensureCrCompatibilityLink(
    { executable: "/runner/tool-cache/calcit-calcit/0.14.3/x64/calcit", installDir: "/runner/tool-cache/calcit-calcit/0.14.3/x64" },
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
    ["copy", "/runner/tool-cache/calcit-calcit/0.14.3/x64/calcit", "/runner/tool-cache/calcit-calcit/0.14.3/x64/cr"],
    ["chmod", "/runner/tool-cache/calcit-calcit/0.14.3/x64/cr", 0o755],
  ]);
});
