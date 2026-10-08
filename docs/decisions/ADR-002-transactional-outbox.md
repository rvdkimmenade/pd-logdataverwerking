# ADR-002: Transactionele outbox

## Status

Accepted

## Context

Een losse businesscommit gevolgd door publicatie kan een logevent verliezen bij een crash. Een gedistribueerde transactie tussen applicatiedatabase en Kafka is ongewenst.

## Decision

Sla businessmutatie en outboxevent op in één lokale databasetransactie. Een aparte publisher verzorgt aflevering en retries.

## Consequences

- Geen verliesvenster tussen businessmutatie en registratie-intentie.
- Applicaties met een database hebben een outboxtabel en publisher nodig.
- Aflevering blijft at-least-once en vereist centrale deduplicatie.
- Applicaties zonder database gebruiken een gedocumenteerde duurzame spool als minder sterke variant.
