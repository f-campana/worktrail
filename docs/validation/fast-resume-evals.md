# Fast Resume evaluation corpus

Fast Resume tests use sanitized synthetic runs to check product-phrase, file-name,
unassigned-run, canonical-workstream, no-result, archived, and ignored behavior.
They also assert deterministic ordering, bounded limits, versioned JSON, inert
resume commands, and the absence of evidence excerpts, home paths, and credentials.

Candidate workstream grouping is intentionally not evaluated or returned in this
slice because no conservative grouping contract is yet established.
