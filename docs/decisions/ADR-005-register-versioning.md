# ADR-005: Versioned Verwerkingsregister

## Status

Accepted

## Context

Een historische logregel moet verklaard worden met de registerinformatie die gold toen de verwerking plaatsvond.

## Decision

Gebruik een stabiele `processing_activity_id` met immutable versies en geldigheidsintervallen. Iedere relevante wijziging creëert een nieuwe versie.

## Consequences

- Gepubliceerde versies worden nooit gewijzigd.
- De Query API resolveert op activiteit-ID en tijdstip.
- De adminconsole toont wijzigingen tussen versies.
- Overlappende geldigheidsintervallen zijn niet toegestaan.
