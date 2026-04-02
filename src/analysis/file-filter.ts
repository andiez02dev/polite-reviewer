import type { ReviewableFile } from "../types.js";

export enum FileCategory {
  UI_COMPONENT = "UI_COMPONENT",
  LOGIC_HOOK = "LOGIC_HOOK",
  API_SERVICE = "API_SERVICE",
  GENERAL = "GENERAL",
}

/**
 * Categorize a file path into a review role so the prompt-builder can
 * apply the most relevant review lens for that file type.
 */
export function categorizeFile(filePath: string): FileCategory {
  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));

  // UI_COMPONENT: TSX/JSX files, or paths with component/view/ui segments
  if (
    ext === ".tsx" ||
    ext === ".jsx" ||
    /\/components\/|\/views\/|\/ui\//.test(lower)
  ) {
    return FileCategory.UI_COMPONENT;
  }

  // API_SERVICE: service/api/controller/repository paths
  if (/\/services\/|\/api\/|\/controllers\/|\/repositories\//.test(lower)) {
    return FileCategory.API_SERVICE;
  }

  // LOGIC_HOOK: hook/utils/helpers paths, or formula/calculator keywords
  if (
    /\/hooks?\/|\/utils\/|\/helpers\//.test(lower) ||
    /formula|calculator/.test(lower)
  ) {
    return FileCategory.LOGIC_HOOK;
  }

  return FileCategory.GENERAL;
}

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

export function isSkippablePath(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (SKIP_PATH_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  if (SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return false;
}

export function isBinaryFile(prFile: { patch?: string | null }): boolean {
  if (!prFile.patch) return true;
  return /\u0000/.test(prFile.patch);
}

export function normalizePatch(patch: string | undefined | null, maxLines = DEFAULT_MAX_PATCH_LINES): string {
  if (!patch) return "";
  const lines = patch.split("\n");
  if (lines.length <= maxLines) return patch;
  return `${lines.slice(0, maxLines).join("\n")}\n... (truncated, ${lines.length - maxLines} lines omitted)`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildReviewableFiles(
  prFiles: unknown[],
  options: { maxPatchLines?: number } = {},
): ReviewableFile[] {
  const maxLines = options.maxPatchLines ?? DEFAULT_MAX_PATCH_LINES;

  return prFiles
    .filter(isRecord)
    .filter((file) => typeof file["filename"] === "string" && !isSkippablePath(file["filename"] as string))
    .filter((file) => {
      const patch = file["patch"];
      if (!patch || typeof patch !== "string") return false;
      return !/\u0000/.test(patch);
    })
    .map((file) => ({
      filename: file["filename"] as string,
      status: typeof file["status"] === "string" ? file["status"] : "modified",
      additions: typeof file["additions"] === "number" ? file["additions"] : 0,
      deletions: typeof file["deletions"] === "number" ? file["deletions"] : 0,
      changes: typeof file["changes"] === "number" ? file["changes"] : 0,
      patch: normalizePatch(file["patch"] as string, maxLines),
    }));
}
