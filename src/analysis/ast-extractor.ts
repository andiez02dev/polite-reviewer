import { Project, SourceFile, Node, SyntaxKind } from "ts-morph";
import type { LogicalBlock } from "../types.js";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const WHITELISTED_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.ArrowFunction,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.FunctionExpression,
]);

export function isAstSupportedFile(filename: string): boolean {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const ext = filename.slice(dotIndex).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function createInMemorySourceFile(
  content: string,
  filename: string,
): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  return project.createSourceFile(filename, content, { overwrite: true });
}

export function findEnclosingNode(
  sourceFile: SourceFile,
  line: number,
): Node | undefined {
  const descendants = sourceFile.getDescendants();

  // Find innermost whitelisted node that contains the line
  let innermostWhitelisted: Node | undefined;
  let innermostSize = Infinity;

  for (const node of descendants) {
    const start = node.getStartLineNumber();
    const end = node.getEndLineNumber();
    if (start <= line && line <= end) {
      if (WHITELISTED_KINDS.has(node.getKind())) {
        const size = end - start;
        if (size < innermostSize) {
          innermostSize = size;
          innermostWhitelisted = node;
        }
      }
    }
  }

  if (innermostWhitelisted) return innermostWhitelisted;

  // Fallback: top-level statement containing the line
  for (const statement of sourceFile.getStatements()) {
    const start = statement.getStartLineNumber();
    const end = statement.getEndLineNumber();
    if (start <= line && line <= end) {
      return statement;
    }
  }

  return undefined;
}

export function cleanBlockText(text: string): string {
  // Strip leading JSDoc comments (/** ... */)
  let cleaned = text.replace(/^\/\*\*[\s\S]*?\*\/\s*/m, "");
  // Normalize 3+ consecutive newlines to 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned;
}

export function extractLogicalBlocks(
  fileContent: string,
  filename: string,
  changedLines: Set<number>,
): LogicalBlock[] {
  if (!isAstSupportedFile(filename)) return [];

  let sourceFile: SourceFile;
  try {
    sourceFile = createInMemorySourceFile(fileContent, filename);
  } catch {
    return [];
  }

  // Map from "startLine:endLine" → { node, coveredLines }
  const blockMap = new Map<
    string,
    { node: Node; coveredLines: Set<number> }
  >();

  for (const line of changedLines) {
    const node = findEnclosingNode(sourceFile, line);
    if (!node) continue;

    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    const key = `${startLine}:${endLine}`;

    if (!blockMap.has(key)) {
      blockMap.set(key, { node, coveredLines: new Set() });
    }
    blockMap.get(key)!.coveredLines.add(line);
  }

  const result: LogicalBlock[] = [];

  for (const [, { node, coveredLines }] of blockMap) {
    const rawText = node.getText();
    const cleaned = cleanBlockText(rawText);
    if (!cleaned.trim()) continue;

    result.push({
      text: cleaned,
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      coveredChangedLines: Array.from(coveredLines).sort((a, b) => a - b),
      nodeKind: SyntaxKind[node.getKind()],
    });
  }

  return result;
}
