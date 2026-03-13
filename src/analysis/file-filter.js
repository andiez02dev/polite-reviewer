const DEFAULT_MAX_PATCH_LINES = 800;

const SKIP_PATH_SUBSTRINGS = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "out/",
  "cdk.out/",
  ".next/",
  ".turbo/",
  ".vercel/",
];

const SKIP_EXTENSIONS = [
  ".lock",
  ".min.js",
  ".min.css",
  ".map",
  ".svg",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
];

export function isSkippablePath(filename) {
  const lower = filename.toLowerCase();

  if (SKIP_PATH_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  if (SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;

  return false;
}

export function isBinaryFile(prFile) {
  // GitHub omits patch for binary files
  if (!prFile.patch) return true;
  // Heuristic: presence of NUL char
  return /\u0000/.test(prFile.patch);
}

export function normalizePatch(patch, maxLines = DEFAULT_MAX_PATCH_LINES) {
  if (!patch) return "";
  const lines = patch.split("\n");
  if (lines.length <= maxLines) return patch;
  return `${lines.slice(0, maxLines).join("\n")}\n... (truncated, ${lines.length - maxLines} lines omitted)`;
}

export function buildReviewableFiles(prFiles, options = {}) {
  const maxLines = options.maxPatchLines || DEFAULT_MAX_PATCH_LINES;

  return prFiles
    .filter((file) => !isSkippablePath(file.filename))
    .filter((file) => !isBinaryFile(file))
    .map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: normalizePatch(file.patch, maxLines),
    }));
}

