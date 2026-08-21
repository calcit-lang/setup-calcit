const fs = require("fs");
const { execFileSync } = require("child_process");
const core = require("@actions/core");
const tc = require("@actions/tool-cache");
const { resolveDepsFile, resolveTools, resolveVersion } = require("./lib/version");
const { assertSupportedPlatform, installTool } = require("./lib/install");

const crWasm = core.getInput("cr-wasm") === "true";
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

function verifyCrVersion(executable, version) {
  const reported = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
  if (reported !== version) {
    throw new Error(`E_SETUP_VERSION_VERIFY: downloaded cr reports '${reported}', expected '${version}'`);
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
  const tools = resolveTools(core.getInput("tools"), crWasm);

  core.info(`Setting up Calcit ${version} from ${source}${depsContent == null ? " (no deps file found)" : ""}`);
  const installations = await Promise.all(tools.map((bin) => installTool({ bin, version, toolCache: tc, info: core.info })));
  for (const installation of installations) {
    core.addPath(installation.installDir);
  }
  const cr = installations.find((installation) => installation.bin === "cr");
  if (cr) {
    verifyCrVersion(cr.executable, version);
  }
  const cacheHit = installations.every((installation) => installation.cacheHit);

  core.setOutput("version", version);
  core.setOutput("version-source", source);
  core.setOutput("deps-file", depsContent == null ? "" : depsFile);
  core.setOutput("tools", tools.join(","));
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
