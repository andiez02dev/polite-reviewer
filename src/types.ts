export interface AppConfig {
  port: number;
  geminiApiKey: string;
  geminiModel: string;
  githubAppId: string;
  githubInstallationId: string | null;
  webhookSecret: string | null;
  githubPrivateKeyPath: string;
  redis: { host: string; port: number };
}

export interface JobData {
  installationId: number;
  repository: { owner: string; name: string };
  pullRequestNumber: number;
  manualTrigger?: boolean;
  triggeredBy?: string;
}

export interface AIReviewComment {
  file: string;
  line: number;
  title: string;
  problem: string;
  impact: string;
  suggestion: string | null;
  suggestionStartLine: number;
  suggestionEndLine: number;
  severity: 'critical' | 'warning' | 'suggestion';
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SummaryIssue {
  file: string;
  line: number;
  title: string;
}

export interface AIReviewSummary {
  overview: string;
  verdict: 'approve' | 'request_changes' | 'comment';
  criticalIssues: SummaryIssue[];
  warnings: SummaryIssue[];
  suggestions: SummaryIssue[];
}

export interface ReviewableFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
}

export interface RepoContext {
  packageJson: string | null;
  tsconfig: string | null;
  configFiles: Array<{ path: string; content: string }>;
}

export interface AIReviewResult {
  comments: AIReviewComment[];
  summary: AIReviewSummary;
}

export interface LogicalBlock {
  text: string;
  startLine: number;
  endLine: number;
  coveredChangedLines: number[];
  nodeKind: string;
}

export interface EnrichedFile extends ReviewableFile {
  logicalBlocks?: LogicalBlock[];
}
