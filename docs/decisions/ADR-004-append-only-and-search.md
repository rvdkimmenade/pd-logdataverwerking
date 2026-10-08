# ADR-004: Append-only bron en zoekprojectie

## Status

Accepted

## Context

Verantwoordingsinformatie moet duurzaam en reconstrueerbaar zijn, terwijl beheerders snel op meerdere kenmerken willen zoeken.

## Decision

Gebruik append-only opslag als gezaghebbende bron en een aparte zoekindex als herbouwbare projectie.

## Consequences

- De zoekindex mag korte achterstand hebben.
- Correcties overschrijven geen origineel record.
- Een indexrebuild moet ondersteund en getest worden.
- Queries die bewijswaarde vereisen halen het originele record uit de bronopslag.
