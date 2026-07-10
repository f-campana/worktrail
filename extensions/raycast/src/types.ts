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
  archived?: boolean;
  confidence: "high" | "medium" | "low";
  score: number;
  scoreVersion: 1 | 2 | 3;
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

export type TargetValidationStatus =
  | "openable"
  | "archived"
  | "missing"
  | "unknown"
  | "invalid";

export type TargetValidationResult = {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  resumeRef: string;
  status: TargetValidationStatus;
  openUrl?: string;
  message?: string;
};

export type WorktrailPreferences = {
  worktrailPath?: string;
  pnpmPath?: string;
  worktrailProjectPath?: string;
  databasePath?: string;
  codexHomePath?: string;
  resultLimit: string;
  includeArchived: boolean;
};
