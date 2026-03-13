export function extractNewLineAnchorsFromPatch(patch) {
  const anchorLines = new Set();
  if (!patch) return anchorLines;

  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split("\n");

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // @@ -oldStart,oldLen +newStart,newLen @@
      const match = line.match(/@@\s+-([0-9]+)(?:,[0-9]+)?\s+\\+([0-9]+)(?:,[0-9]+)?\s+@@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      continue;
    }

    // Skip diff headers
    if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;

    if (line.startsWith("+")) {
      // Added line exists only in new file
      anchorLines.add(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      // Removed line exists only in old file
      oldLine += 1;
      continue;
    }

    // Context line (starts with space or empty string)
    // GitHub review comments can be anchored to context lines in the diff too.
    anchorLines.add(newLine);
    oldLine += 1;
    newLine += 1;
  }

  return anchorLines;
}

export function clampToNearestAnchor(targetLine, anchors) {
  if (!anchors || anchors.size === 0) return null;
  if (anchors.has(targetLine)) return targetLine;

  // Find nearest anchor by absolute distance
  let best = null;
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

export function annotatePatchWithNewLineNumbers(patch) {
  if (!patch) return "";

  let oldLine = 0;
  let newLine = 0;

  const out = [];
  const lines = patch.split("\n");

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@\s+-([0-9]+)(?:,[0-9]+)?\s+\\+([0-9]+)(?:,[0-9]+)?\s+@@/);
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

