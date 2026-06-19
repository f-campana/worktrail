# Contributing

## Branching

- Branch from `main`.
- Name branches with intent prefixes:
  - `feat/*`
  - `fix/*`
  - `chore/*`
  - `docs/*`
  - `codex/*`

## Commits

Use Conventional Commits:

- `feat`
- `fix`
- `docs`
- `style`
- `refactor`
- `perf`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

Example:

```
feat(schema): add source confidence index
```

## Pull Requests

1. Use a semantic PR title.
2. Link the issue or context.
3. Explain behavior/contract impact.
4. Run and report:
   - `pnpm typecheck && pnpm test && pnpm ui:build`

## Merge Policy

- Prefer squash merge unless release tooling requires otherwise.
- Keep `main` protected in GitHub settings.
