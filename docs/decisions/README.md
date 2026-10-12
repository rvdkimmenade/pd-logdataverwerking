# Architecture Decision Records

ADR's leggen vast waarom een belangrijke en moeilijk terug te draaien keuze is gemaakt. De actuele architectuur staat in `docs/architecture/`.

Statussen: Proposed, Accepted, Superseded of Rejected.

## Register

- [ADR-001: Kafka als event backbone](ADR-001-kafka-as-event-backbone.md)
- [ADR-002: Transactionele outbox](ADR-002-transactional-outbox.md)
- [ADR-003: At-least-once en idempotentie](ADR-003-at-least-once-delivery.md)
- [ADR-004: Append-only bron en zoekprojectie](ADR-004-append-only-and-search.md)
- [ADR-005: Versioned Verwerkingsregister](ADR-005-register-versioning.md)
- [ADR-006: Technologie en repository-indeling](ADR-006-technology-and-repository.md) — Accepted
- [ADR-007: Lokale en productie-infrastructuur](ADR-007-infrastructure.md) — Accepted
- [ADR-008: Authenticatie en autorisatie](ADR-008-authentication-and-authorization.md) — Accepted
- [ADR-009: Lokale Kafka-viewer](ADR-009-local-kafka-viewer.md) — Accepted
- [ADR-010: Registerbeheer in fase 2, OIDC in fase 6](ADR-010-register-management-phase-2.md) — Accepted
- [ADR-011: Stabiele ingest-identiteit bij retries](ADR-011-ingest-retry-identity.md) — Accepted
- [ADR-012: Lokale OIDC-console en sessies](ADR-012-console-oidc-local.md) — uitwerking van ADR-008/010 en expliciete lokale providerkeuze
