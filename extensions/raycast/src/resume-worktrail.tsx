import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  List,
  type LaunchProps,
  openCommandPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";

import {
  debugCommandFromError,
  sanitizeErrorMessage,
  searchWorktrail,
} from "./client.js";
import {
  buildTargetDetailMarkdown,
  deriveTargetDisplay,
  diagnosticMessages,
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
  | { status: "error"; message: string; debugCommand?: string };

type ResumeWorktrailArguments = { query?: string };

export default function ResumeWorktrail(
  props: LaunchProps<{ arguments: ResumeWorktrailArguments }>,
) {
  const preferences = getPreferenceValues<WorktrailPreferences>();
  const {
    databasePath,
    includeArchived,
    pnpmPath,
    resultLimit,
    worktrailProjectPath,
    worktrailPath,
  } = preferences;
  const [searchText, setSearchText] = useState(props.arguments.query ?? "");
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [isShowingDetail, setIsShowingDetail] = useState(false);
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
          pnpmPath,
          resultLimit,
          worktrailProjectPath,
          worktrailPath,
        },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setState({ status: "success", result });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const debugCommand = debugCommandFromError(error);
          setState({
            status: "error",
            message: sanitizeErrorMessage(error, [
              worktrailPath ?? "",
              worktrailProjectPath ?? "",
              databasePath ?? "",
            ]),
            ...(debugCommand ? { debugCommand } : {}),
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    databasePath,
    includeArchived,
    pnpmPath,
    query,
    resultLimit,
    worktrailProjectPath,
    worktrailPath,
  ]);

  const result = state.status === "success" ? state.result : undefined;
  const targets = result?.targets ?? [];
  const diagnostics = diagnosticMessages(result?.diagnostics ?? []);

  return (
    <List
      filtering={false}
      isLoading={state.status === "loading"}
      isShowingDetail={isShowingDetail && targets.length > 0}
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
              isShowingDetail={isShowingDetail}
              onToggleDetail={() => setIsShowingDetail((visible) => !visible)}
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
            {state.debugCommand ? (
              <Action.CopyToClipboard
                content={state.debugCommand}
                icon={Icon.Terminal}
                title="Copy Debug Command"
              />
            ) : null}
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
  isShowingDetail,
  onToggleDetail,
  target,
}: {
  diagnostics: string[];
  isShowingDetail: boolean;
  onToggleDetail: () => void;
  target: ResumableTarget;
}) {
  const display = deriveTargetDisplay(target);
  const actions = targetActions(target);
  const displayTitle = sanitizeDisplayText(target.title) || "Untitled target";
  return (
    <List.Item
      accessories={[
        ...display.accessoryLabels.map((label) => ({
          tag: {
            value: label,
            color:
              label === "Archived"
                ? Color.SecondaryText
                : target.confidence === "high"
                  ? Color.Green
                  : target.confidence === "medium"
                    ? Color.Orange
                    : Color.SecondaryText,
          },
        })),
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Declared Worktrail Actions">
            {actions.map((action, index) => (
              <DeclaredAction
                key={`${action.kind}:${action.value}:${index}`}
                action={action}
              />
            ))}
          </ActionPanel.Section>
          <ActionPanel.Section title="Target">
            <Action
              icon={Icon.Eye}
              onAction={onToggleDetail}
              shortcut={{ modifiers: ["cmd"], key: "i" }}
              title={isShowingDetail ? "Hide Details" : "Show Details"}
            />
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
      subtitle={display.subtitle}
      title={displayTitle}
    />
  );
}

function DeclaredAction({
  action,
}: {
  action: ResumableTarget["openActions"][number];
}) {
  if (action.kind === "open-codex") {
    return (
      <Action.Open
        icon={Icon.AppWindow}
        target={action.value}
        title={sanitizeDisplayText(action.label)}
      />
    );
  }
  return (
    <Action.CopyToClipboard
      content={action.value}
      icon={action.kind === "copy-command" ? Icon.Terminal : Icon.Hashtag}
      title={sanitizeDisplayText(action.label)}
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
  const markdown = buildTargetDetailMarkdown(target, diagnostics);

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Open in Codex"
            text={display.opensInCodex ? "Available" : "Unavailable"}
          />
          <List.Item.Detail.Metadata.Label
            title="Last activity"
            text={display.lastActivity}
          />
          <List.Item.Detail.Metadata.Label
            title="Source"
            text={display.source}
          />
          <List.Item.Detail.Metadata.Label
            title="Confidence"
            text={display.confidence}
          />
          {display.archived ? (
            <List.Item.Detail.Metadata.Label
              title="Archive state"
              text="Archived"
            />
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Score"
            text={`${target.score.toFixed(3)} (v${target.scoreVersion})`}
          />
          {target.resumeRef ? (
            <List.Item.Detail.Metadata.Label
              title="Resume UUID"
              text={target.resumeRef}
            />
          ) : null}
        </List.Item.Detail.Metadata>
      }
    />
  );
}
