import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  List,
  openCommandPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";

import { sanitizeErrorMessage, searchWorktrail } from "./client.js";
import {
  deriveTargetDisplay,
  diagnosticMessages,
  escapeMarkdown,
  sanitizeDisplayText,
  targetActions,
} from "./display.js";
import type {
  ResumableTarget,
  ResumeSearchResult,
  WorktrailPreferences,
} from "./types.js";

const SEARCH_DEBOUNCE_MS = 250;

type ViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: ResumeSearchResult }
  | { status: "error"; message: string };

export default function ResumeWorktrail() {
  const preferences = getPreferenceValues<WorktrailPreferences>();
  const { databasePath, includeArchived, resultLimit, worktrailProjectPath } =
    preferences;
  const [searchText, setSearchText] = useState("");
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const query = searchText.trim();

  useEffect(() => {
    if (!query) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });
    const timeout = setTimeout(() => {
      void searchWorktrail(
        query,
        {
          databasePath,
          includeArchived,
          resultLimit,
          worktrailProjectPath,
        },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setState({ status: "success", result });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            message: sanitizeErrorMessage(error, [
              worktrailProjectPath,
              databasePath ?? "",
            ]),
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [databasePath, includeArchived, query, resultLimit, worktrailProjectPath]);

  const result = state.status === "success" ? state.result : undefined;
  const targets = result?.targets ?? [];
  const diagnostics = diagnosticMessages(result?.diagnostics ?? []);

  return (
    <List
      filtering={false}
      isLoading={state.status === "loading"}
      isShowingDetail={targets.length > 0}
      navigationTitle="Resume Worktrail"
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Type what you remember"
      searchText={searchText}
    >
      {targets.length > 0 ? (
        <List.Section
          title={`${targets.length} ranked target${targets.length === 1 ? "" : "s"}`}
          subtitle={
            diagnostics.length > 0
              ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`
              : undefined
          }
        >
          {targets.map((target, index) => (
            <TargetItem
              key={`${target.kind}:${target.title}:${target.lastActivity}:${index}`}
              diagnostics={diagnostics}
              target={target}
            />
          ))}
        </List.Section>
      ) : (
        <EmptyState query={query} state={state} />
      )}
    </List>
  );
}

function EmptyState({ query, state }: { query: string; state: ViewState }) {
  if (state.status === "error") {
    return (
      <List.EmptyView
        actions={
          <ActionPanel>
            <Action
              icon={Icon.Gear}
              onAction={openCommandPreferences}
              title="Open Command Preferences"
            />
          </ActionPanel>
        }
        description={state.message}
        icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
        title="Worktrail search failed"
      />
    );
  }
  if (state.status === "loading") {
    return (
      <List.EmptyView
        description="Requesting ranked targets from the Worktrail CLI."
        icon={Icon.Clock}
        title="Searching Worktrail"
      />
    );
  }
  if (state.status === "success" && query) {
    return (
      <List.EmptyView
        description="Try a feature, file, decision, or project name."
        icon={Icon.MagnifyingGlass}
        title="No resumable work found"
      />
    );
  }
  return (
    <List.EmptyView
      description="Search by remembered work context; Worktrail ranks the results."
      icon={Icon.TextCursor}
      title="Type what you remember"
    />
  );
}

function TargetItem({
  diagnostics,
  target,
}: {
  diagnostics: string[];
  target: ResumableTarget;
}) {
  const display = deriveTargetDisplay(target);
  const actions = targetActions(target);
  const displayTitle = sanitizeDisplayText(target.title) || "Untitled target";
  return (
    <List.Item
      accessories={[
        ...(target.sourceTool
          ? [{ text: sanitizeDisplayText(target.sourceTool) }]
          : []),
        {
          tag: {
            value: target.confidence,
            color:
              target.confidence === "high"
                ? Color.Green
                : target.confidence === "medium"
                  ? Color.Orange
                  : Color.SecondaryText,
          },
        },
        ...(target.relatedFiles.length > 0
          ? [
              {
                text: `${target.relatedFiles.length} file${target.relatedFiles.length === 1 ? "" : "s"}`,
                icon: Icon.Document,
              },
            ]
          : []),
        {
          icon: display.resumable ? Icon.Clipboard : Icon.XMarkCircle,
          tooltip: display.resumable
            ? "Resume command available"
            : "No resume command available",
        },
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Declared Worktrail Actions">
            {actions.map((action, index) => (
              <Action.CopyToClipboard
                key={`${action.kind}:${action.value}:${index}`}
                content={action.value}
                icon={
                  action.kind === "copy-command" ? Icon.Terminal : Icon.Hashtag
                }
                title={sanitizeDisplayText(action.label)}
              />
            ))}
          </ActionPanel.Section>
          <ActionPanel.Section title="Target">
            {target.resumeRef ? (
              <Action.CopyToClipboard
                content={target.resumeRef}
                icon={Icon.Hashtag}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                title="Copy Resume UUID"
              />
            ) : null}
            <Action.CopyToClipboard
              content={displayTitle}
              icon={Icon.Text}
              title="Copy Target Title"
            />
            <Action
              icon={Icon.Gear}
              onAction={openCommandPreferences}
              title="Open Command Preferences"
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
      detail={<TargetDetail diagnostics={diagnostics} target={target} />}
      icon={target.kind === "run" ? Icon.Terminal : Icon.Folder}
      subtitle={display.subtitle}
      title={displayTitle}
    />
  );
}

function TargetDetail({
  diagnostics,
  target,
}: {
  diagnostics: string[];
  target: ResumableTarget;
}) {
  const display = deriveTargetDisplay(target);
  const command = targetActions(target).find(
    (action) => action.kind === "copy-command",
  );
  const signalLines = target.signals.length
    ? target.signals
        .slice(0, 8)
        .map(
          (signal) => `- ${escapeMarkdown(sanitizeDisplayText(signal.label))}`,
        )
        .join("\n")
    : "- No signals supplied";
  const fileLines = display.relatedFiles.length
    ? display.relatedFiles
        .map((file) => `- \`${file.replace(/`/g, "\\`")}\``)
        .join("\n")
    : "- No related files supplied";
  const runLines = target.relatedRuns.length
    ? target.relatedRuns
        .slice(0, 8)
        .map((run) => {
          const title = sanitizeDisplayText(run.title ?? "Related run");
          const activity = deriveTargetDisplay({
            ...target,
            lastActivity: run.lastActivity,
          }).lastActivity;
          return `- ${escapeMarkdown(title)} — ${escapeMarkdown(activity)}`;
        })
        .join("\n")
    : "- No related runs supplied";
  const diagnosticSection = diagnostics.length
    ? `\n\n## Diagnostics\n\n${diagnostics.map((message) => `- ${escapeMarkdown(message)}`).join("\n")}`
    : "";
  const markdown = command
    ? `## Resume command\n\n\`\`\`sh\n${command.value.replace(/`/g, "\\`")}\n\`\`\`\n\n## Why this matched\n\n${signalLines}\n\n## Related files\n\n${fileLines}\n\n## Related runs\n\n${runLines}${diagnosticSection}`
    : `## Resume command\n\nUnavailable. Worktrail did not declare a copyable resume command for this target.\n\n## Why this matched\n\n${signalLines}\n\n## Related files\n\n${fileLines}\n\n## Related runs\n\n${runLines}${diagnosticSection}`;

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Kind" text={display.kind} />
          <List.Item.Detail.Metadata.Label
            title="Confidence"
            text={display.confidence}
          />
          <List.Item.Detail.Metadata.Label
            title="Last activity"
            text={display.lastActivity}
          />
          {target.sourceTool ? (
            <List.Item.Detail.Metadata.Label
              title="Source tool"
              text={sanitizeDisplayText(target.sourceTool)}
            />
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Score"
            text={`${target.score.toFixed(3)} (v${target.scoreVersion})`}
          />
          <List.Item.Detail.Metadata.Label
            title="Resume"
            text={display.resumable ? "Command available" : "Unavailable"}
          />
          <List.Item.Detail.Metadata.Label
            title="Related files"
            text={String(target.relatedFiles.length)}
          />
          <List.Item.Detail.Metadata.Label
            title="Related runs"
            text={String(target.relatedRuns.length)}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );
}
