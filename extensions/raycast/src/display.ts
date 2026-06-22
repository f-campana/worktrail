import { homedir } from "node:os";

import type {
  ResumableTarget,
  ResumeDiagnostic,
  ResumeOpenAction,
} from "./types.js";

export type TargetDisplay = {
  kind: string;
  confidence: string;
  confidenceShort: "High" | "Med" | "Low";
  confidenceExplanation: string;
  lastActivity: string;
  relativeActivity: string;
  source: string;
  primaryMatch: string;
  subtitle: string;
  accessoryLabels: string[];
  relatedFiles: string[];
  resumable: boolean;
  opensInCodex: boolean;
  archived: boolean;
};

export function deriveTargetDisplay(
  target: ResumableTarget,
  now = new Date(),
): TargetDisplay {
  const kind =
    target.kind === "canonical-workstream"
      ? "Canonical workstream"
      : target.kind === "candidate-workstream"
        ? "Candidate workstream"
        : "Run";
  const confidenceShort =
    target.confidence === "high"
      ? "High"
      : target.confidence === "medium"
        ? "Med"
        : "Low";
  const confidence = `${capitalize(target.confidence)} confidence`;
  const confidenceExplanation =
    target.confidence === "high"
      ? "Strong title, project, workstream, or alias evidence."
      : target.confidence === "medium"
        ? "Useful title or path evidence, or broader multi-term coverage."
        : "Weak content or generic-file evidence; verify before opening.";
  const lastActivity = formatActivity(target.lastActivity);
  const relativeActivity = formatRelativeActivity(target.lastActivity, now);
  const source = sourceLabel(target.sourceTool);
  const primaryMatch = compactMatchLabel(target);
  const archived = target.archived === true;
  return {
    kind,
    confidence,
    confidenceShort,
    confidenceExplanation,
    lastActivity,
    relativeActivity,
    source,
    primaryMatch,
    subtitle: [source, relativeActivity, primaryMatch].join(" · "),
    accessoryLabels: [confidenceShort, ...(archived ? ["Archived"] : [])],
    relatedFiles: target.relatedFiles
      .map(sanitizeDisplayText)
      .filter((file) => file.length > 0)
      .slice(0, 8),
    resumable: selectCopyCommand(target) !== undefined,
    opensInCodex: selectCodexOpenAction(target) !== undefined,
    archived,
  };
}

export function buildTargetDetailMarkdown(
  target: ResumableTarget,
  diagnostics: string[] = [],
): string {
  const display = deriveTargetDisplay(target);
  const title = escapeMarkdown(
    sanitizeDisplayText(target.title) || "Untitled target",
  );
  const signalLines = target.signals.length
    ? target.signals
        .filter((signal) => signal.type !== "recent-activity")
        .slice(0, 8)
        .map(
          (signal) => `- ${escapeMarkdown(sanitizeDisplayText(signal.label))}`,
        )
        .join("\n")
    : "- Worktrail did not supply a match explanation.";
  const activity = `${escapeMarkdown(display.lastActivity)} · ${escapeMarkdown(display.source)}${display.archived ? " · Archived" : ""}`;
  const files = display.relatedFiles.length
    ? `\n\n## Related files\n\n${display.relatedFiles
        .map((file) => `- \`${file.replace(/`/g, "\\`")}\``)
        .join("\n")}`
    : "";
  const command = selectCopyCommand(target);
  const fallback = command
    ? `\n\n## Resume command fallback\n\n\`\`\`sh\n${command.value.replace(/`/g, "\\`")}\n\`\`\``
    : "\n\n## Resume command fallback\n\nUnavailable for this target.";
  const runs =
    target.relatedRuns.length > 1
      ? `\n\n## Related runs\n\n${target.relatedRuns
          .slice(0, 8)
          .map((run) => {
            const runTitle = escapeMarkdown(
              sanitizeDisplayText(run.title ?? "Related run"),
            );
            return `- ${runTitle} — ${escapeMarkdown(formatActivity(run.lastActivity))}`;
          })
          .join("\n")}`
      : "";
  const debugValues = [
    `- Score: ${target.score.toFixed(3)} (v${target.scoreVersion})`,
    ...(target.sourceTool
      ? [
          `- Source tool: ${escapeMarkdown(sanitizeDisplayText(target.sourceTool))}`,
        ]
      : []),
    ...(target.resumeRef
      ? [`- Resume UUID: \`${target.resumeRef.replace(/`/g, "\\`")}\``]
      : []),
    `- Related files: ${target.relatedFiles.length}`,
    `- Related runs: ${target.relatedRuns.length}`,
  ].join("\n");
  const diagnosticSection = diagnostics.length
    ? `\n\n## Diagnostics\n\n${diagnostics
        .map((message) => `- ${escapeMarkdown(message)}`)
        .join("\n")}`
    : "";

  return `# ${title}\n\n**Open in Codex:** ${display.opensInCodex ? "Available — press Enter from the result list." : "Unavailable"}\n\n## Why this matched\n\n${signalLines}\n\n## Activity\n\n${activity}\n\n## Confidence\n\n**${display.confidenceShort}** — ${display.confidenceExplanation}${files}${fallback}${runs}\n\n## Debug\n\n${debugValues}${diagnosticSection}`;
}

export function selectCodexOpenAction(
  target: ResumableTarget,
): ResumeOpenAction | undefined {
  return target.openActions.find(
    (action) =>
      action.kind === "open-codex" &&
      action.value === `codex://threads/${target.resumeRef}` &&
      /^codex:\/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        action.value,
      ),
  );
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
  const codexOpen = selectCodexOpenAction(target);
  const command = selectCopyCommand(target);
  const actions = [
    ...target.openActions.filter(
      (action) => action.kind !== "open-codex" || action === codexOpen,
    ),
    ...(command && !target.openActions.includes(command) ? [command] : []),
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

function compactMatchLabel(target: ResumableTarget): string {
  const signal = target.signals.find(
    (item) =>
      ![
        "recent-activity",
        "unassigned-run",
        "manual-assignment",
        "project-membership",
        "archived-penalty",
      ].includes(item.type),
  );
  if (!signal) return "matched context";
  const quoted = signal.label.match(/“([^”]+)”/u)?.[1];
  switch (signal.type) {
    case "exact-title-match":
      return "exact title";
    case "title-prefix-match":
      return quoted ? `title prefix: ${quoted}` : "title prefix";
    case "title-phrase-match":
    case "title-token-match":
      return quoted ? `title: ${quoted}` : "title match";
    case "exact-project-match":
    case "project-path-match":
      return quoted ? `project: ${quoted}` : "project match";
    case "project-identity-match":
      return quoted ? `project: ${quoted}` : "project match";
    case "project-alias-match":
      return quoted ? `alias: ${quoted}` : "project alias match";
    case "alias-match":
      return quoted ? `alias: ${quoted}` : "alias match";
    case "exact-entity-match":
    case "entity-match":
    case "workstream-name-match":
      return "workstream match";
    case "meaningful-path-match":
      return quoted ? `path: ${quoted}` : "path match";
    case "generic-file-match":
      return "generic file match";
    case "content-only-match":
      return target.confidence === "low"
        ? "weak content-only match"
        : "content match";
    default:
      return sanitizeDisplayText(signal.label);
  }
}

function sourceLabel(sourceTool?: string): string {
  const source = sanitizeDisplayText(sourceTool ?? "");
  if (!source || source === "codex" || source === "codex-local") return "Codex";
  return source;
}

function formatActivity(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Activity time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelativeActivity(value: string, now: Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "activity unknown";
  const elapsedDays = Math.floor((now.valueOf() - date.valueOf()) / 86_400_000);
  if (elapsedDays < 0) return formatShortDate(date);
  if (elapsedDays === 0) return "today";
  if (elapsedDays === 1) return "yesterday";
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  if (elapsedDays < 35) return `${Math.floor(elapsedDays / 7)}w ago`;
  if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}mo ago`;
  return formatShortDate(date);
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(date);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
