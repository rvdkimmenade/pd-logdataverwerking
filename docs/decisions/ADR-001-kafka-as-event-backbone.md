# ADR-001: Kafka als event backbone

## Status

Accepted

## Context

Applicaties mogen niet afhankelijk zijn van de beschikbaarheid of verwerkingssnelheid van centrale logopslag. Piekbelasting, replay en meerdere consumers moeten mogelijk zijn.

## Decision

Gebruik Kafka als duurzame transport- en distributielaag tussen Ingest API en downstream verwerking.

## Consequences

- Producent en opslag zijn tijdtechnisch ontkoppeld.
- Backpressure en replay zijn mogelijk.
- Kafka moet hoog beschikbaar en actief beheerd worden.
- Kafka is niet het juridische archief; definitieve records gaan naar append-only opslag.

## Alternatives considered

Synchrone databasewrites, een eenvoudige message queue en directe REST-opslag.
