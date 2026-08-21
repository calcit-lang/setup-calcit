const path = require("path");

const CALCIT_VERSION = /:calcit-version\s+\|?([^\s)\]\}]+)/g;
const SEMVER_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER = new RegExp(
  `^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);
const SUPPORTED_TOOLS = new Set(["cr", "caps", "cr-wasm"]);

function parseCalcitVersion(content, source = "deps.cirru") {
  const matches = Array.from(content.matchAll(CALCIT_VERSION), (match) => match[1]);

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new Error(`E_SETUP_VERSION_INVALID: found ${matches.length} :calcit-version declarations in ${source}`);
  }
  if (!SEMVER.test(matches[0])) {
    throw new Error(`E_SETUP_VERSION_INVALID: '${matches[0]}' in ${source} is not a Calcit release version`);
  }
  return matches[0];
}

function resolveVersion({ depsContent, depsFile, inputVersion }) {
  const fileVersion = depsContent == null ? null : parseCalcitVersion(depsContent, depsFile);
  const explicitVersion = inputVersion.trim();

  if (fileVersion && explicitVersion && fileVersion !== explicitVersion) {
    throw new Error(
      `E_SETUP_VERSION_CONFLICT: ${depsFile} declares ${fileVersion}, but the version input requests ${explicitVersion}. Remove the input or make both values identical.`,
    );
  }
  if (fileVersion) {
    return { version: fileVersion, source: "deps-file" };
  }
  if (explicitVersion) {
    if (!SEMVER.test(explicitVersion)) {
      throw new Error(`E_SETUP_VERSION_INVALID: version input '${explicitVersion}' is not a Calcit release version`);
    }
    return { version: explicitVersion, source: "input" };
  }
  throw new Error(
    `E_SETUP_VERSION_MISSING: declare :calcit-version in ${depsFile}, or supply the version input for a task without a project deps file.`,
  );
}

function resolveDepsFile(workspace, requestedPath) {
  const file = requestedPath.trim() || "deps.cirru";
  const resolvedWorkspace = path.resolve(workspace);
  const resolvedFile = path.resolve(resolvedWorkspace, file);
  const relative = path.relative(resolvedWorkspace, resolvedFile);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`E_SETUP_DEPS_PATH: deps-file '${file}' must stay inside the GitHub workspace`);
  }
  return { file, resolvedFile };
}

function resolveTools(toolsInput, crWasm) {
  const requested = (toolsInput || "cr,caps")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);

  if (crWasm && !requested.includes("cr-wasm")) {
    requested.push("cr-wasm");
  }
  if (requested.length === 0) {
    throw new Error("E_SETUP_TOOLS_EMPTY: tools must contain at least one supported tool");
  }

  const unique = new Set();
  for (const tool of requested) {
    if (!SUPPORTED_TOOLS.has(tool)) {
      throw new Error(`E_SETUP_TOOL_UNKNOWN: '${tool}' is not supported; use cr, caps, or cr-wasm`);
    }
    if (unique.has(tool)) {
      throw new Error(`E_SETUP_TOOL_DUPLICATE: '${tool}' appears more than once`);
    }
    unique.add(tool);
  }
  return [...unique];
}

module.exports = { parseCalcitVersion, resolveDepsFile, resolveTools, resolveVersion };
