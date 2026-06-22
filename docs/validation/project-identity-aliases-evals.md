# Project Identity + Aliases v0 — Phase 1 evaluations

Date: 2026-06-22

Resume schema version: 1

Resume score version: 3

## Evaluation policy

These checks use the installed CLI and the local SQLite index. Titles are kept
because they are product-visible labels; source UUIDs, transcript excerpts,
raw home paths, remotes, diffs, and command output are omitted. “Baseline” is
the score-v3 index before adding a project alias. “Current” is after the
explicit `SC → scaleway` correction and a subsequent index reconciliation.

Archived targets are excluded by default. `fast resume` is also checked with
archived targets included because the strongest title matches are archived.

## Baseline and current results

| Query                        | Expected top target                                           | Baseline top                   | Current top                                                | Confidence / score | Compact current signals                    | Project | Alias | Archive effect | Opens in Codex |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- | ------------------ | ------------------------------------------ | ------- | ----- | -------------- | -------------- |
| `scaleway`                   | `SC \| Review PieChart component`                             | same                           | same                                                       | high / 0.960       | project identity, membership, project/path | yes     | no    | no             | yes            |
| `SC`                         | `SC \| Review PieChart component`                             | same, title prefix only        | same, explicit alias                                       | high / 0.985       | project alias, membership, title prefix    | yes     | yes   | no             | yes            |
| `shipready`                  | `Write MCP plan spec`                                         | same                           | same                                                       | high / 0.960       | project identity, membership, project/path | yes     | no    | no             | yes            |
| `ship-ready`                 | same identity as `shipready`                                  | `Write MCP plan spec`          | `Write MCP plan spec`                                      | high / 0.960       | project identity, membership, project/path | yes     | no    | no             | yes            |
| `worktrail`                  | current Worktrail run                                         | `Add project identity aliases` | same                                                       | high / 0.960       | project identity, membership, project/path | yes     | no    | no             | yes            |
| `fast resume`                | specific Fast Resume title when archived results are included | `Refine Fast Resume UX`        | same                                                       | high / 0.950       | title phrase, path, archived penalty       | no      | no    | yes            | yes            |
| `github profile`             | `Job \| Audit GitHub profile`                                 | same                           | same                                                       | high / 0.980       | title phrase, path                         | no      | no    | no             | yes            |
| `profile`                    | specific title, but not high confidence                       | `Job \| Audit GitHub profile`  | same                                                       | medium / 0.720     | title token, path                          | no      | no    | no             | yes            |
| `zzzznonexistenttoken987654` | no result in a corpus that does not contain the sentinel      | no result                      | low content-only self-match after this task was re-indexed | low / 0.340        | content only                               | no      | no    | no             | yes            |

All current results use score version 3. Project identity changed only the
project-oriented queries. `fast resume`, `github profile`, and `profile` did
not acquire project-alias signals.

## `SC` correction delta

Before the command, `SC` scored 0.985 through `title-prefix-match`; no project
alias existed or was claimed. After:

```sh
worktrail projects aliases add scaleway SC --allow-write --json
```

the same title-strong target retained score 0.985 and gained
`project-alias-match` plus `project-membership`. The alias independently scores
project members at high confidence. A second index run preserved it.

## No-result sentinel caveat

The required `zzzznonexistenttoken987654` string is present in this
implementation request. It was absent at the baseline check, then became valid
low-confidence content evidence when the active implementation thread was
re-indexed. This is corpus self-contamination, not alias or identity inference.
No special case was added. A fresh sentinel, `qqqqnohitclosure246813579`,
returned zero targets in the final installed-CLI check.

## Synthetic closure

The committed synthetic tests additionally verify:

- Git common-dir and linked-worktree grouping;
- unrelated same-basename directories remaining distinct;
- conservative non-Git cwd fallback and missing-path diagnostics;
- alias add/list/remove, conflict rejection, and reconciliation survival;
- no `SC` alias inference from a title prefix;
- project identity/alias precedence over content-only evidence;
- separator-insensitive `shipready` / `ship-ready` identity matching;
- archive/ignore behavior, deterministic ordering, and privacy boundaries;
- compact Raycast project/alias rendering and declared action order.
