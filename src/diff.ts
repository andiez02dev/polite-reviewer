import type { ReviewableFile } from "./types.js";

const SKIP_PATH_PATTERNS = [
  "node_modules/",
  "dist/",
  "build/",
  ".lock",
];

function shouldSkipFile(filename: string): boolean {
  return SKIP_PATH_PATTERNS.some((p) => filename.includes(p));
}

function isBinary(file: { patch?: string | null }): boolean {
  if (!file.patch) return true;
  return false;
}

export function buildReviewableFiles(
  files: Array<{ filename: string; additions: number; deletions: number; patch?: string | null }>,
): ReviewableFile[] {
  const maxPatchLines = 800;

  return files
    .filter((file) => !shouldSkipFile(file.filename))
    .filter((file) => !isBinary(file))
    .map((file) => {
      const patch = file.patch ?? "";
      const lines = patch.split("\n");
      const trimmed =
        lines.length > maxPatchLines
          ? `${lines.slice(0, maxPatchLines).join("\n")}\n... (truncated)`
          : patch;

      return {
        filename: file.filename,
        status: "modified",
        additions: file.additions,
        deletions: file.deletions,
        changes: file.additions + file.deletions,
        patch: trimmed,
      };
    });
}
