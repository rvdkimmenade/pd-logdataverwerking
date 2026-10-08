# Repository instructions

## Project

This repository contains a proof of concept for the Dutch Logboek Dataverwerkingen (LDV) standard. The platform provides asynchronous ingestion, Kafka-based durable transport, append-only log storage, a versioned processing register, a searchable read model and an administrative console.

## Sources of truth

Read only the documents relevant to the task:

- `docs/architecture/overview.md` for system boundaries and component responsibilities.
- `docs/architecture/reliability.md` for delivery guarantees and failure behaviour.
- `docs/architecture/security.md` for security and privacy constraints.
- `docs/ldv/standard-profile.md` for LDV compliance.
- `docs/ldv/processing-register.md` for register behaviour.
- `contracts/` for API and event contracts.
- `docs/decisions/` for accepted architectural decisions.
- `docs/testing/test-strategy.md` for verification requirements.

Do not duplicate contracts or normative rules in source-code comments.

## Architectural rules

- Applications must not write directly to central log storage.
- Prefer the transactional outbox pattern for reliable publication.
- Delivery is at-least-once; every consumer must be idempotent.
- Deduplicate log records using `event_id`.
- Persist accepted log records append-only.
- Treat Kafka as transport, not as the authoritative archive.
- Treat the search index as rebuildable, not authoritative.
- Resolve processing activities using ID and event timestamp.
- Keep LDV, audit/security logging and telemetry logically separated.
- Never place employee identity in an LDV log record.
- Never mutate a published processing-activity version.
- Commit Kafka offsets only after durable processing has succeeded.

## Development workflow

- Change the relevant OpenAPI, AsyncAPI or JSON Schema contract before changing externally visible behaviour.
- Preserve backward compatibility within a major contract version.
- Add contract tests for interface changes.
- Add resilience tests for changes to event delivery.
- Add an ADR for decisions that materially change the architecture.
- Do not edit generated files manually.
- Do not commit secrets, credentials or personal data.
- Run the repository verification command before completing a change.

## Planning

For work spanning multiple services, data migrations or significant architectural changes, create and maintain an execution plan according to `.agent/PLANS.md`.

## Completion criteria

A change is complete when implementation, tests, contracts and documentation agree; failure behaviour is tested; and fixtures and logs contain no secrets or real personal data.


## Implementation roadmap

For implementation work, read `docs/implementation/roadmap.md` and determine the current phase before changing code.

- Work on only one implementation phase at a time.
- Create or update an ExecPlan in `.agent/plans/` for that phase.
- Do not implement deliverables assigned to a later phase.
- Run every automated gate for the current phase.
- If a gate fails, fix it before proceeding.
- Record evidence in `docs/implementation/status.md`.
- Never mark a phase complete based only on code review or compilation.
- Do not start the next phase until all exit criteria are met.
- Phase 0 requires human approval of technology and security decisions.
- Any later architectural deviation requires an ADR and renewed approval when it changes public contracts, security boundaries or data retention.
