# ADR-003: At-least-once aflevering en idempotentie

## Status

Accepted

## Context

Netwerkpartities en crashes maken het onmogelijk om aflevering en verwerking met alleen acknowledgements ondubbelzinnig vast te stellen.

## Decision

Gebruik at-least-once transport. Elk event heeft een stabiele `event_id`; consumers zijn idempotent en de logopslag heeft een unieke constraint op deze ID.

## Consequences

- Duplicaten zijn normaal en veilig.
- Offsetcommit volgt pas na duurzame verwerking.
- Alle side effects moeten herhaalbaar of dedupliceerbaar zijn.
- Tests simuleren crashes rond database- en offsetcommits.
