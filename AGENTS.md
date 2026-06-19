# AGENTS.md

## Scope
Apply these instructions to the whole repository root.

## Collaboration Contract
- Use short-lived branches from `main`.
- Keep commits in Conventional Commit format.
- Keep PR titles semantic (Conventional Commit style).
- Keep PRs focused and small.
- Run the quality command before requesting merge:
  - `pnpm typecheck && pnpm test && pnpm ui:build`

## Safety Rules
- Do not rewrite history on shared branches unless explicitly requested.
- Do not use destructive git commands (`reset --hard`, `clean -fd`) without explicit approval.
- Do not commit secrets or credentials.

## Reporting
- State changed files and why.
- State validation commands run and results.
- State remaining risk or follow-up.
