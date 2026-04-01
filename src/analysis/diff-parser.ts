export function extractNewLineAnchorsFromPatch(patch: string | undefined | null): Set<number> {
  const anchorLines = new Set<number>();
  if (!patch) return anchorLines;

  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split("\n");

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@\s+-([0-9]+)(?:,[0-9]+)?\s+\+([0-9]+)(?:,[0-9]+)?\s+@@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      continue;
    }

    if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;

    if (line.startsWith("+")) {
      anchorLines.add(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      oldLine += 1;
      continue;
    }

    anchorLines.add(newLine);
    oldLine += 1;
    newLine += 1;
  }

  return anchorLines;
}

export function clampToNearestAnchor(targetLine: number, anchors: Set<number>): number | null {
  if (!anchors || anchors.size === 0) return null;
  if (anchors.has(targetLine)) return targetLine;

  let best: number | null = null;
  let bestDist = Infinity;
  for (const a of anchors) {
    const dist = Math.abs(a - targetLine);
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  }
  return best;
}

export function annotatePatchWithNewLineNumbers(patch: string | undefined | null): string {
  if (!patch) return "";

  let oldLine = 0;
  let newLine = 0;

  const out: string[] = [];
  const lines = patch.split("\n");

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@\s+-([0-9]+)(?:,[0-9]+)?\s+\+([0-9]+)(?:,[0-9]+)?\s+@@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      out.push(line);
      continue;
    }

    if (line.startsWith("diff --git") || line.startsWith("index ")) {
      out.push(line);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      out.push(line);
      continue;
    }

    if (line.startsWith("+")) {
      out.push(`${String(newLine).padStart(5, " ")} | ${line}`);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      out.push(`${String(oldLine).padStart(5, " ")} | ${line}`);
      oldLine += 1;
      continue;
    }

    out.push(`${String(newLine).padStart(5, " ")} | ${line}`);
    oldLine += 1;
    newLine += 1;
  }

  return out.join("\n");
}
