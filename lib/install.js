const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");

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

function standaloneCapsCacheName() {
  return "calcit-caps-release";
}

function downloadUrl(bin, version) {
  return `https://github.com/calcit-lang/calcit/releases/download/${version}/${bin}`;
}

function manifestUrl(version) {
  return downloadUrl("calcit-release-manifest.json", version);
}

function capsDownloadUrl(asset, version) {
  return `https://github.com/calcit-lang/caps/releases/download/${version}/${asset}`;
}

function capsManifestUrl(version) {
  return capsDownloadUrl("caps-release-manifest.json", version);
}

function isNotFoundError(error) {
  return error?.httpStatusCode === 404 || error?.statusCode === 404;
}

async function downloadReleaseManifest({ version, toolCache, apiToken, info = () => {}, fileSystem = fs }) {
  try {
    const downloaded = await downloadReleaseAsset({
      url: manifestUrl(version), repository: "calcit-lang/calcit", assetName: "calcit-release-manifest.json",
      version, toolCache, apiToken, info, fileSystem,
    });
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

async function downloadCapsReleaseManifest({ version, toolCache, apiToken, info = () => {}, fileSystem = fs }) {
  const downloaded = await downloadReleaseAsset({
    url: capsManifestUrl(version), repository: "calcit-lang/caps", assetName: "caps-release-manifest.json",
    version, toolCache, apiToken, info, fileSystem,
  });
  let manifest;
  try {
    manifest = JSON.parse(fileSystem.readFileSync(downloaded, "utf8"));
  } catch (_error) {
    throw new Error(`E_SETUP_CAPS_MANIFEST_INVALID: malformed release manifest for ${version}`);
  }
  if (manifest == null || manifest.schemaVersion !== 1 || manifest.version !== version || !Array.isArray(manifest.assets)) {
    throw new Error(`E_SETUP_CAPS_MANIFEST_INVALID: malformed release manifest for ${version}`);
  }
  for (const asset of manifest.assets) {
    if (typeof asset?.name !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0) {
      throw new Error(`E_SETUP_CAPS_MANIFEST_INVALID: malformed asset record in release manifest for ${version}`);
    }
  }
  return manifest;
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

/** Retrieve an official release asset and verify the API metadata on gateway-error fallback. */
async function downloadReleaseAsset({ url, repository, assetName, version, toolCache, apiToken, info, fileSystem }) {
  try {
    return await toolCache.downloadTool(url);
  } catch (error) {
    const status = error?.httpStatusCode ?? error?.statusCode;
    if (![502, 503, 504].includes(status)) {
      throw error;
    }
    info(`Release download returned HTTP ${status} for ${assetName} ${version}; trying the GitHub Release asset API`);
    const releaseApi = `https://api.github.com/repos/${repository}/releases`;
    const auth = apiToken ? `Bearer ${apiToken}` : undefined;
    try {
      const metadata = await toolCache.downloadTool(`${releaseApi}/tags/${encodeURIComponent(version)}`, undefined, auth);
      const release = JSON.parse(fileSystem.readFileSync(metadata, "utf8"));
      const asset = release?.assets?.find((item) => item.name === assetName);
      const sha256 = /^sha256:([a-f0-9]{64})$/.exec(asset?.digest)?.[1];
      if (release?.tag_name !== version || !Number.isSafeInteger(asset?.id) || asset.id <= 0 ||
          !sha256 || !Number.isSafeInteger(asset.size) || asset.size < 0) {
        throw new Error("no matching asset with a published SHA-256 and size on the requested release");
      }
      const downloaded = await toolCache.downloadTool(`${releaseApi}/assets/${asset.id}`, undefined, auth, {
        accept: "application/octet-stream",
      });
      verifyAssetChecksum({
        downloaded, assetName, fileSystem,
        manifest: { version, assets: [{ name: assetName, sha256, size: asset.size }] },
      });
      return downloaded;
    } catch (apiError) {
      throw new Error(`E_SETUP_RELEASE_ASSET_API: could not download ${assetName} ${version} after HTTP ${status}: ${apiError.message}`, {
        cause: apiError,
      });
    }
  }
}

async function installTool({ bin, version, toolCache, manifest = null, apiToken, info = () => {}, fileSystem = fs }) {
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
    downloaded = await downloadReleaseAsset({
      url, repository: "calcit-lang/calcit", assetName: bin, version, toolCache, apiToken, info, fileSystem,
    });
  } catch (error) {
    if (bin !== "calcit" || !isNotFoundError(error)) {
      throw error;
    }
    const legacyUrl = downloadUrl("cr", version);
    info(`Calcit asset is unavailable for ${version}; using the compatible legacy cr asset from ${legacyUrl}`);
    installedUrl = legacyUrl;
    downloaded = await downloadReleaseAsset({
      url: legacyUrl, repository: "calcit-lang/calcit", assetName: "cr", version, toolCache, apiToken, info, fileSystem,
    });
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
  manifest,
  apiToken,
  info = () => {},
  fileSystem = fs,
}) {
  const bin = "caps";
  const tool = standaloneCapsCacheName();
  const cachedDir = toolCache.find(tool, version);
  if (cachedDir) {
    info(`Using cached standalone caps ${version} from ${cachedDir}`);
    const executable = path.join(cachedDir, bin);
    verifyAssetChecksum({ downloaded: executable, assetName: bin, manifest, fileSystem });
    return {
      bin,
      executable,
      installDir: cachedDir,
      cacheHit: true,
    };
  }

  const url = capsDownloadUrl(bin, version);
  const downloaded = await downloadReleaseAsset({
    url, repository: "calcit-lang/caps", assetName: bin, version, toolCache, apiToken, info, fileSystem,
  });
  verifyAssetChecksum({ downloaded, assetName: bin, manifest, fileSystem });
  const installDir = await toolCache.cacheFile(downloaded, bin, tool, version);
  const executable = path.join(installDir, bin);
  fileSystem.chmodSync(executable, 0o755);
  info(`Installed standalone caps ${version} from ${url}`);
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
  capsDownloadUrl,
  capsManifestUrl,
  cacheName,
  downloadCapsReleaseManifest,
  downloadReleaseManifest,
  downloadUrl,
  ensureCrCompatibilityLink,
  installTool,
  installStandaloneCaps,
  manifestUrl,
  standaloneCapsCacheName,
  verifyAssetChecksum,
};
