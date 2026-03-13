const SKIP_PATH_PATTERNS = [
  "node_modules/",
  "dist/",
  "build/",
  ".lock",
];

function shouldSkipFile(filename) {
  return SKIP_PATH_PATTERNS.some((p) => filename.includes(p));
}

function isBinary(file) {
  // GitHub omits patch for binary files
  if (!file.patch) return true;
  return false;
}

export function buildReviewableFiles(files) {
  const maxPatchLines = 800;

  return files
    .filter((file) => !shouldSkipFile(file.filename))
    .filter((file) => !isBinary(file))
    .map((file) => {
      const lines = file.patch.split("\n");
      const trimmed =
        lines.length > maxPatchLines
          ? `${lines.slice(0, maxPatchLines).join("\n")}\n... (truncated)`
          : file.patch;

      return {
        filename: file.filename,
        additions: file.additions,
        deletions: file.deletions,
        patch: trimmed,
      };
    });
}

