import { Project, SourceFile, Node, SyntaxKind } from "ts-morph";
import type { LogicalBlock } from "../types.js";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Meaningful parent scopes for smart ancestor traversal.
 * VariableStatement catches arrow functions / React hooks assigned to variables:
 *   export const useHook = () => { ... }
 */
const MEANINGFUL_PARENT_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.VariableStatement,
]);

/** Broader whitelist used by the LogicalBlock extraction path */
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

/**
 * Traverse UP the AST from the node at `line` to find the closest
 * "Meaningful Parent Scope": FunctionDeclaration, ClassDeclaration, or
 * VariableStatement. Falls back to the top-level statement if none found.
 */
export function findMeaningfulParent(
  sourceFile: SourceFile,
  line: number,
): Node | undefined {
  // Find the deepest node whose range contains the line
  let target: Node | undefined;
  for (const node of sourceFile.getDescendants()) {
    if (
      node.getStartLineNumber() <= line &&
      line <= node.getEndLineNumber()
    ) {
      // Prefer deeper nodes (smaller span)
      if (
        !target ||
        node.getEndLineNumber() - node.getStartLineNumber() <
          target.getEndLineNumber() - target.getStartLineNumber()
      ) {
        target = node;
      }
    }
  }

  if (!target) return undefined;

  // Walk up to find the closest meaningful parent scope
  let current: Node | undefined = target;
  while (current) {
    if (MEANINGFUL_PARENT_KINDS.has(current.getKind())) {
      return current;
    }
    current = current.getParent();
  }

  // Fallback: top-level statement containing the line
  for (const statement of sourceFile.getStatements()) {
    if (
      statement.getStartLineNumber() <= line &&
      line <= statement.getEndLineNumber()
    ) {
      return statement;
    }
  }

  return undefined;
}

/** Original enclosing-node finder used by extractLogicalBlocks */
export function findEnclosingNode(
  sourceFile: SourceFile,
  line: number,
): Node | undefined {
  const descendants = sourceFile.getDescendants();

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

/**
 * Extract root-level imports from the source file.
 */
function extractImports(sourceFile: SourceFile): string[] {
  return sourceFile
    .getImportDeclarations()
    .map((n) => n.getText().trim())
    .filter(Boolean);
}

/**
 * Extract root-level type aliases and interface declarations.
 */
function extractRootTypes(sourceFile: SourceFile): string[] {
  const results: string[] = [];
  for (const statement of sourceFile.getStatements()) {
    const kind = statement.getKind();
    if (
      kind === SyntaxKind.TypeAliasDeclaration ||
      kind === SyntaxKind.InterfaceDeclaration
    ) {
      results.push(statement.getText().trim());
    }
  }
  return results;
}

/**
 * Smart AST extraction that returns a formatted string for LLM consumption.
 *
 * Always includes:
 *  - All import statements
 *  - All root-level type aliases and interface declarations
 *
 * For each changed line, traverses UP the AST to find the closest
 * FunctionDeclaration, ClassDeclaration, or VariableStatement (which catches
 * arrow functions / React hooks). Deduplicates blocks by start:end line key.
 *
 * Returns a formatted string grouped as:
 *   [imports]
 *   [types/interfaces]
 *   [changed scopes]
 */
export function extractAstContext(
  fileContent: string,
  changedLines: number[],
): string {
  let sourceFile: SourceFile;
  try {
    sourceFile = createInMemorySourceFile(fileContent, "file.ts");
  } catch {
    return fileContent;
  }

  const parts: string[] = [];

  // 1. Root-level imports
  const imports = extractImports(sourceFile);
  if (imports.length > 0) {
    parts.push(imports.join("\n"));
  }

  // 2. Root-level types and interfaces
  const types = extractRootTypes(sourceFile);
  if (types.length > 0) {
    parts.push(types.join("\n\n"));
  }

  // 3. Smart ancestor traversal — deduplicated by "startLine:endLine"
  const seen = new Set<string>();
  const scopeBlocks: string[] = [];

  for (const line of changedLines) {
    const node = findMeaningfulParent(sourceFile, line);
    if (!node) continue;

    const key = `${node.getStartLineNumber()}:${node.getEndLineNumber()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cleaned = cleanBlockText(node.getText());
    if (cleaned.trim()) {
      scopeBlocks.push(cleaned);
    }
  }

  if (scopeBlocks.length > 0) {
    parts.push(scopeBlocks.join("\n\n"));
  }

  return parts.join("\n\n");
}

/**
 * Original LogicalBlock-based extraction used by the prompt-builder pipeline.
 */
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
