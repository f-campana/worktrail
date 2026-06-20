import { homedir } from "node:os";

import type {
  ResumableTarget,
  ResumeDiagnostic,
  ResumeOpenAction,
} from "./types.js";

export type TargetDisplay = {
  kind: string;
  confidence: string;
  lastActivity: string;
  subtitle: string;
  relatedFiles: string[];
  resumable: boolean;
};

export function deriveTargetDisplay(target: ResumableTarget): TargetDisplay {
  const kind =
    target.kind === "canonical-workstream"
      ? "Canonical workstream"
      : target.kind === "candidate-workstream"
        ? "Candidate workstream"
        : "Run";
  const confidence = `${capitalize(target.confidence)} confidence`;
  const lastActivity = formatActivity(target.lastActivity);
  return {
    kind,
    confidence,
    lastActivity,
    subtitle: [confidence, kind, lastActivity].join(" · "),
    relatedFiles: target.relatedFiles
      .map(sanitizeDisplayText)
      .filter((file) => file.length > 0)
      .slice(0, 8),
    resumable: selectCopyCommand(target) !== undefined,
  };
}

export function selectCopyCommand(
  target: ResumableTarget,
): ResumeOpenAction | undefined {
  const declared = target.openActions.find(
    (action) => action.kind === "copy-command" && action.value.trim(),
  );
  if (declared) return declared;
  if (!target.resumeCommand?.trim()) return undefined;
  return {
    kind: "copy-command",
    label: "Copy Codex resume command",
    value: target.resumeCommand,
  };
}

export function targetActions(target: ResumableTarget): ResumeOpenAction[] {
  const command = selectCopyCommand(target);
  const actions = [
    ...(command ? [command] : []),
    ...target.openActions.filter((action) => action !== command),
  ];
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}\u0000${action.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function diagnosticMessages(diagnostics: ResumeDiagnostic[]): string[] {
  return [
    ...new Set(diagnostics.map((item) => sanitizeDisplayText(item.message))),
  ].filter(Boolean);
}

export function sanitizeDisplayText(value: string): string {
  return value
    .split(homedir())
    .join("~")
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/\/home\/[^/\s]+/g, "~")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[credentials]@",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");
}

function formatActivity(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Activity time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
