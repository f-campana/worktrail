# ADR 0001: Local-first and evidence-backed operation

## Status

Accepted

## Context

Worktrail processes agent transcripts, repository paths, and delivery metadata. These can contain sensitive code, credentials, and business context. Reconstructed state is also easy to overstate when its provenance is hidden.

## Decision

Worktrail's core operation is local-first. Raw source records remain at their source; persisted searchable content is bounded and redacted before storage. Claims expose provenance and confidence, sensitive evidence is fetched or shown only after explicit disclosure, and unsupported completion or blocker claims are not synthesized. Remote connectors may provide future metadata, but cloud storage or model calls are not prerequisites for core behavior.

## Consequences

- Local indexing and deterministic processing remain useful offline.
- Connectors must minimize access and keep source provenance.
- Redaction reduces risk but is not a complete security boundary.
- Some polished summaries are unavailable unless explicitly added as optional processing.

## Alternatives considered

- **Cloud-first aggregation:** easier multi-device access, rejected as a core dependency because it increases trust and credential scope.
- **Store raw transcripts:** maximizes recall, rejected because the privacy cost is disproportionate.
- **Summary without visible evidence:** simpler presentation, rejected because users cannot verify reconstructed state.
