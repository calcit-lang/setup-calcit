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
  const downloaded = await toolCache.downloadTool(url);
  const installDir = await toolCache.cacheFile(downloaded, bin, tool, version);
  const executable = path.join(installDir, bin);
  fileSystem.chmodSync(executable, 0o755);
  info(`Installed ${bin} from ${url}`);
  return { bin, executable, installDir, cacheHit: false };
}

module.exports = { assertSupportedPlatform, cacheName, downloadUrl, installTool };
