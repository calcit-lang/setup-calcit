const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");
const { execFileSync } = require("child_process");

function assertSupportedPlatform(platform = os.platform(), arch = os.arch()) {
  if (platform !== "linux" || arch !== "x64") {
    throw new Error(
      `E_SETUP_PLATFORM_UNSUPPORTED: setup-calcit currently publishes tools only for linux/x64; received ${platform}/${arch}`,
    );
  }
}

function cacheName(bin) {
  return `calcit-${bin}`;
}

function downloadUrl(bin, version) {
  return `https://github.com/calcit-lang/calcit/releases/download/${version}/${bin}`;
}

function manifestUrl(version) {
  return downloadUrl("calcit-release-manifest.json", version);
}

function isNotFoundError(error) {
  return error?.httpStatusCode === 404 || error?.statusCode === 404;
}

async function downloadReleaseManifest({ version, toolCache, info = () => {}, fileSystem = fs }) {
  try {
    const downloaded = await toolCache.downloadTool(manifestUrl(version));
    let manifest;
    try {
      manifest = JSON.parse(fileSystem.readFileSync(downloaded, "utf8"));
    } catch (_error) {
      throw new Error(`E_SETUP_MANIFEST_INVALID: malformed release manifest for ${version}`);
    }
    if (manifest.schemaVersion !== 1 || manifest.version !== version || !Array.isArray(manifest.assets)) {
      throw new Error(`E_SETUP_MANIFEST_INVALID: malformed release manifest for ${version}`);
    }
    for (const asset of manifest.assets) {
      if (typeof asset?.name !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0) {
        throw new Error(`E_SETUP_MANIFEST_INVALID: malformed asset record in release manifest for ${version}`);
      }
    }
    return manifest;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    info(`Release ${version} has no checksum manifest; continuing in legacy compatibility mode`);
    return null;
  }
}

function verifyAssetChecksum({ downloaded, assetName, manifest, fileSystem = fs }) {
  if (manifest == null) {
    return;
  }
  const asset = manifest.assets.find((item) => item.name === assetName);
  if (asset == null) {
    throw new Error(`E_SETUP_MANIFEST_ASSET_MISSING: release manifest for ${manifest.version} has no ${assetName} checksum`);
  }
  const content = fileSystem.readFileSync(downloaded);
  const actualHash = createHash("sha256").update(content).digest("hex");
  if (actualHash !== asset.sha256 || content.length !== asset.size) {
    throw new Error(
      `E_SETUP_CHECKSUM_MISMATCH: ${assetName} for ${manifest.version} did not match the published release manifest`,
    );
  }
}

async function installTool({ bin, version, toolCache, manifest = null, info = () => {}, fileSystem = fs }) {
  const tool = cacheName(bin);
  const cachedDir = toolCache.find(tool, version);
  if (cachedDir) {
    info(`Using cached ${bin} ${version} from ${cachedDir}`);
    const executable = path.join(cachedDir, bin);
    verifyAssetChecksum({ downloaded: executable, assetName: bin, manifest, fileSystem });
    return {
      bin,
      executable,
      installDir: cachedDir,
      cacheHit: true,
    };
  }

  const url = downloadUrl(bin, version);
  let installedUrl = url;
  let downloaded;
  try {
    downloaded = await toolCache.downloadTool(url);
  } catch (error) {
    if (bin !== "calcit" || !isNotFoundError(error)) {
      throw error;
    }
    const legacyUrl = downloadUrl("cr", version);
    info(`Calcit asset is unavailable for ${version}; using the compatible legacy cr asset from ${legacyUrl}`);
    installedUrl = legacyUrl;
    downloaded = await toolCache.downloadTool(legacyUrl);
  }
  verifyAssetChecksum({ downloaded, assetName: path.basename(installedUrl), manifest, fileSystem });
  const installDir = await toolCache.cacheFile(downloaded, bin, tool, version);
  const executable = path.join(installDir, bin);
  fileSystem.chmodSync(executable, 0o755);
  info(`Installed ${bin} from ${installedUrl}`);
  return { bin, executable, installDir, cacheHit: false };
}

async function installStandaloneCaps({
  version,
  toolCache,
  info = () => {},
  fileSystem = fs,
  execute = execFileSync,
  tempDirectory = os.tmpdir(),
}) {
  const bin = "caps";
  const tool = cacheName(bin);
  const cachedDir = toolCache.find(tool, version);
  if (cachedDir) {
    info(`Using cached standalone caps ${version} from ${cachedDir}`);
    return {
      bin,
      executable: path.join(cachedDir, bin),
      installDir: cachedDir,
      cacheHit: true,
    };
  }

  const installRoot = fileSystem.mkdtempSync(path.join(tempDirectory, "setup-calcit-caps-"));
  info(`Installing standalone calcit-caps ${version} from crates.io`);
  execute(
    "cargo",
    ["install", "calcit-caps", "--version", version, "--locked", "--root", installRoot],
    { stdio: "inherit" },
  );
  const builtExecutable = path.join(installRoot, "bin", bin);
  if (!fileSystem.existsSync(builtExecutable)) {
    throw new Error(`E_SETUP_CAPS_INSTALL: cargo install did not create ${builtExecutable}`);
  }
  const installDir = await toolCache.cacheFile(builtExecutable, bin, tool, version);
  const executable = path.join(installDir, bin);
  fileSystem.chmodSync(executable, 0o755);
  info(`Installed standalone caps ${version} from crates.io`);
  return { bin, executable, installDir, cacheHit: false };
}

function ensureCrCompatibilityLink(installation, fileSystem = fs) {
  const compatibilityPath = path.join(installation.installDir, "cr");
  if (fileSystem.existsSync(compatibilityPath)) {
    return compatibilityPath;
  }

  try {
    fileSystem.symlinkSync(path.basename(installation.executable), compatibilityPath);
  } catch (error) {
    fileSystem.copyFileSync(installation.executable, compatibilityPath);
    fileSystem.chmodSync(compatibilityPath, 0o755);
  }
  return compatibilityPath;
}

module.exports = {
  assertSupportedPlatform,
  cacheName,
  downloadReleaseManifest,
  downloadUrl,
  ensureCrCompatibilityLink,
  installTool,
  installStandaloneCaps,
  manifestUrl,
  verifyAssetChecksum,
};
