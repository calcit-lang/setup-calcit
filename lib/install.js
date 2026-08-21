const fs = require("fs");
const os = require("os");
const path = require("path");

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

function isNotFoundError(error) {
  return error?.httpStatusCode === 404 || error?.statusCode === 404;
}

async function installTool({ bin, version, toolCache, info = () => {}, fileSystem = fs }) {
  const tool = cacheName(bin);
  const cachedDir = toolCache.find(tool, version);
  if (cachedDir) {
    info(`Using cached ${bin} ${version} from ${cachedDir}`);
    return {
      bin,
      executable: path.join(cachedDir, bin),
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
  const installDir = await toolCache.cacheFile(downloaded, bin, tool, version);
  const executable = path.join(installDir, bin);
  fileSystem.chmodSync(executable, 0o755);
  info(`Installed ${bin} from ${installedUrl}`);
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

module.exports = { assertSupportedPlatform, cacheName, downloadUrl, ensureCrCompatibilityLink, installTool };
