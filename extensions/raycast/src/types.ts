export const SUPPORTED_SCHEMA_VERSION = 1 as const;

export type ResumeSignal = {
  type: string;
  label: string;
  weight?: number;
  sourceIds?: string[];
};

export type RelatedRun = {
  sourceId: string;
  title?: string;
  resumeRef?: string;
  lastActivity: string;
};

export type ResumeOpenAction = {
  kind: "open-codex" | "copy-command" | "copy-id";
  label: string;
  value: string;
};

export type ResumableTarget = {
  kind: "canonical-workstream" | "candidate-workstream" | "run";
  title: string;
  subtitle?: string;
  resumeRef?: string;
  resumeCommand?: string;
  command?: { program: "codex"; args: string[] };
  lastActivity: string;
  sourceTool?: string;
  confidence: "high" | "medium" | "low";
  score: number;
  scoreVersion: 1;
  signals: ResumeSignal[];
  relatedFiles: string[];
  relatedRuns: RelatedRun[];
  openActions: ResumeOpenAction[];
  evidenceAvailable: boolean;
};

export type ResumeDiagnostic = {
  code: "unsafe-resume-ref";
  message: string;
  sourceId: string;
};

export type ResumeSearchResult = {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  query: string;
  generatedAt: string;
  limit: number;
  targets: ResumableTarget[];
  diagnostics: ResumeDiagnostic[];
};

export type WorktrailPreferences = {
  worktrailPath?: string;
  pnpmPath?: string;
  worktrailProjectPath?: string;
  databasePath?: string;
  resultLimit: string;
  includeArchived: boolean;
};
