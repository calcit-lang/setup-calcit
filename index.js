const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const core = require("@actions/core");
const tc = require("@actions/tool-cache");
const { resolveDepsFile, resolveTools, resolveVersion } = require("./lib/version");

const crWasm = core.getInput("cr-wasm") === "true";
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

function createInstallDir(version) {
  const base = process.env.RUNNER_TEMP || os.tmpdir();
  return fs.mkdtempSync(path.join(base, `setup-calcit-${version}-`));
}

async function installTool({ bin, version, installDir }) {
  const url = `https://github.com/calcit-lang/calcit/releases/download/${version}/${bin}`;
  const downloaded = await tc.downloadTool(url);
  const destination = path.join(installDir, bin);
  fs.copyFileSync(downloaded, destination);
  fs.chmodSync(destination, 0o755);
  core.info(`Installed ${bin} from ${url}`);
}

function verifyCrVersion(installDir, version) {
  const reported = execFileSync(path.join(installDir, "cr"), ["--version"], { encoding: "utf8" }).trim();
  if (reported !== version) {
    throw new Error(`E_SETUP_VERSION_VERIFY: downloaded cr reports '${reported}', expected '${version}'`);
  }
}

module.exports = setup;

async function setup() {
  const { file: depsFile, resolvedFile } = resolveDepsFile(workspace, core.getInput("deps-file"));
  const depsContent = fs.existsSync(resolvedFile) ? fs.readFileSync(resolvedFile, "utf8") : null;
  const { version, source } = resolveVersion({
    depsContent,
    depsFile,
    inputVersion: core.getInput("version"),
  });
  const tools = resolveTools(core.getInput("tools"), crWasm);
  const installDir = createInstallDir(version);

  core.info(`Setting up Calcit ${version} from ${source}${depsContent == null ? " (no deps file found)" : ""}`);
  await Promise.all(tools.map((bin) => installTool({ bin, version, installDir })));
  core.addPath(installDir);
  if (tools.includes("cr")) {
    verifyCrVersion(installDir, version);
  }

  core.setOutput("version", version);
  core.setOutput("version-source", source);
  core.setOutput("deps-file", depsContent == null ? "" : depsFile);
  core.setOutput("tools", tools.join(","));
  await core.summary
    .addHeading("Calcit setup")
    .addTable([
      [{ data: "Version", header: true }, version],
      [{ data: "Source", header: true }, source],
      [{ data: "Tools", header: true }, tools.join(", ")],
    ])
    .write();
}

if (require.main === module) {
  setup().catch((error) => core.setFailed(error.message || error));
}
