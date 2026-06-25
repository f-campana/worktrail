import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  List,
  Toast,
  type LaunchProps,
  open,
  openCommandPreferences,
  showToast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";

import {
  cachedResumeSearchResult,
  debugCommandFromError,
  invalidateResumeSearchCache,
  sanitizeErrorMessage,
  searchWorktrail,
  validateWorktrailTarget,
} from "./client.js";
import {
  buildTargetDetailMarkdown,
  deriveTargetDisplay,
  diagnosticMessages,
  sanitizeDisplayText,
  targetActions,
} from "./display.js";
import {
  SearchRequestCoordinator,
  type SearchRequest,
} from "./search-session.js";
import type {
  ResumableTarget,
  ResumeSearchResult,
  WorktrailPreferences,
} from "./types.js";

const SEARCH_DEBOUNCE_MS = 120;

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
  const [refreshToken, setRefreshToken] = useState(0);
  const requestCoordinator = useRef(new SearchRequestCoordinator()).current;
  const query = searchText.trim();
  const searchPreferences = {
    databasePath,
    includeArchived,
    pnpmPath,
    resultLimit,
    worktrailProjectPath,
    worktrailPath,
  };

  useEffect(() => {
    if (!query) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "idle" });
    let request: SearchRequest | undefined;
    const timeout = setTimeout(() => {
      request = requestCoordinator.begin();
      const cached = cachedResumeSearchResult(query, searchPreferences);
      if (cached) setState({ status: "success", result: cached });
      else setState({ status: "loading" });
      void searchWorktrail(query, searchPreferences, request.signal, {
        bypassCache: true,
      })
        .then((result) => {
          if (request?.isCurrent()) setState({ status: "success", result });
        })
        .catch((error: unknown) => {
          if (!request?.isCurrent()) return;
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
      request?.cancel();
    };
  }, [
    databasePath,
    includeArchived,
    pnpmPath,
    query,
    refreshToken,
    requestCoordinator,
    resultLimit,
    worktrailProjectPath,
    worktrailPath,
  ]);

  const result =
    state.status === "success" && state.result.query === query
      ? state.result
      : undefined;
  const visibleState: ViewState =
    state.status === "success" && !result ? { status: "idle" } : state;
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
              onValidationStale={() => setRefreshToken((value) => value + 1)}
              preferences={searchPreferences}
              query={query}
              target={target}
            />
          ))}
        </List.Section>
      ) : (
        <EmptyState query={query} state={visibleState} />
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
  onValidationStale,
  onToggleDetail,
  preferences,
  query,
  target,
}: {
  diagnostics: string[];
  isShowingDetail: boolean;
  onValidationStale: () => void;
  onToggleDetail: () => void;
  preferences: WorktrailPreferences;
  query: string;
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
                onValidationStale={onValidationStale}
                preferences={preferences}
                query={query}
                target={target}
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
  onValidationStale,
  preferences,
  query,
  target,
}: {
  action: ResumableTarget["openActions"][number];
  onValidationStale: () => void;
  preferences: WorktrailPreferences;
  query: string;
  target: ResumableTarget;
}) {
  if (action.kind === "open-codex") {
    return (
      <Action
        icon={Icon.AppWindow}
        onAction={() =>
          void validateAndOpenCodex({
            action,
            onValidationStale,
            preferences,
            query,
            target,
          })
        }
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

async function validateAndOpenCodex({
  action,
  onValidationStale,
  preferences,
  query,
  target,
}: {
  action: ResumableTarget["openActions"][number];
  onValidationStale: () => void;
  preferences: WorktrailPreferences;
  query: string;
  target: ResumableTarget;
}) {
  if (!target.resumeRef) return;
  await showToast({
    style: Toast.Style.Animated,
    title: "Checking Codex thread",
  });
  try {
    const validation = await validateWorktrailTarget(
      target.resumeRef,
      preferences,
    );
    const openUrl =
      validation.status === "openable" &&
      validation.openUrl === action.value &&
      isDeclaredCodexThreadUrl(validation.openUrl, target.resumeRef)
        ? validation.openUrl
        : undefined;
    if (openUrl) {
      await open(openUrl);
      await showToast({ style: Toast.Style.Success, title: "Opening Codex" });
      return;
    }

    if (validation.status === "archived" || validation.status === "missing") {
      invalidateResumeSearchCache(query, preferences);
      onValidationStale();
    }
    await showToast({
      style: Toast.Style.Failure,
      title: validationTitle(validation.status),
      message: validation.message,
    });
  } catch (error: unknown) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Worktrail validation failed",
      message: sanitizeErrorMessage(error, [
        preferences.worktrailPath ?? "",
        preferences.worktrailProjectPath ?? "",
        preferences.databasePath ?? "",
      ]),
    });
  }
}

function isDeclaredCodexThreadUrl(url: string, resumeRef: string): boolean {
  return (
    url === `codex://threads/${resumeRef}` &&
    /^codex:\/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      url,
    )
  );
}

function validationTitle(status: string): string {
  switch (status) {
    case "archived":
      return "Thread is archived";
    case "missing":
      return "Thread is unavailable";
    case "unknown":
      return "Thread state is unknown";
    default:
      return "Cannot open Codex thread";
  }
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
