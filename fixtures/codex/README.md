# Codex Parser Fixtures

These fixtures are fully synthetic. No session ID, path, repository, prompt,
command, output, diff, or title was copied from local Codex data.

- `rollout-legacy-sanitized.jsonl` covers message records and the legacy
  `function_call` / string `function_call_output` shape.
- `rollout-current-sanitized.jsonl` covers turn context, content blocks,
  `custom_tool_call`, content-block output, and structured patch changes.
- `session-index-sanitized.jsonl` covers repeated title updates for one thread.

Keep fixtures minimal and synthetic. Never commit a raw rollout, shell snapshot,
attachment, auth file, or state-database export.
