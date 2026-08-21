const fs = require("fs");
const { execFileSync } = require("child_process");
const core = require("@actions/core");
const tc = require("@actions/tool-cache");
const { resolveDepsFile, resolveToolOutput, resolveTools, resolveVersion } = require("./lib/version");
const { assertSupportedPlatform, downloadReleaseManifest, ensureCrCompatibilityLink, installTool } = require("./lib/install");

const crWasm = core.getInput("cr-wasm") === "true";
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

function verifyCalcitVersion(executable, version) {
  const reported = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
  if (reported !== version) {
    throw new Error(`E_SETUP_VERSION_VERIFY: downloaded calcit reports '${reported}', expected '${version}'`);
  }
}

module.exports = setup;

async function setup() {
  assertSupportedPlatform();
  const { file: depsFile, resolvedFile } = resolveDepsFile(workspace, core.getInput("deps-file"));
  const depsContent = fs.existsSync(resolvedFile) ? fs.readFileSync(resolvedFile, "utf8") : null;
  const { version, source } = resolveVersion({
    depsContent,
    depsFile,
    inputVersion: core.getInput("version"),
  });
  const toolsInput = core.getInput("tools");
  const tools = resolveTools(toolsInput, crWasm);
  const outputTools = resolveToolOutput(toolsInput, crWasm);

  core.info(`Setting up Calcit ${version} from ${source}${depsContent == null ? " (no deps file found)" : ""}`);
  const manifest = await downloadReleaseManifest({ version, toolCache: tc, info: core.info });
  const installations = await Promise.all(tools.map((bin) => installTool({ bin, version, toolCache: tc, manifest, info: core.info })));
  for (const installation of installations) {
    core.addPath(installation.installDir);
  }
  const calcit = installations.find((installation) => installation.bin === "calcit");
  if (calcit) {
    ensureCrCompatibilityLink(calcit);
    verifyCalcitVersion(calcit.executable, version);
  }
  const cacheHit = installations.every((installation) => installation.cacheHit);

  core.setOutput("version", version);
  core.setOutput("version-source", source);
  core.setOutput("deps-file", depsContent == null ? "" : depsFile);
  core.setOutput("tools", outputTools.join(","));
  core.setOutput("cache-hit", String(cacheHit));
  await core.summary
    .addHeading("Calcit setup")
    .addTable([
      [{ data: "Version", header: true }, version],
      [{ data: "Source", header: true }, source],
      [{ data: "Tools", header: true }, tools.join(", ")],
      [{ data: "Cache hit", header: true }, String(cacheHit)],
    ])
    .write();
}

if (require.main === module) {
  setup().catch((error) => core.setFailed(error.message || error));
}
