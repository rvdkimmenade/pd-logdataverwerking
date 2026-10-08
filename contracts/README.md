# Contracten

Deze map is de bron van waarheid voor externe interfaces.

- `openapi/`: synchrone HTTP-interfaces.
- `asyncapi/`: Kafka-topics en eventcontracten.
- `schemas/`: herbruikbare JSON Schema-definities.
- `examples/`: valide en ongeldige voorbeeldberichten.

## Regels

- Wijzig eerst het contract en daarna de implementatie.
- Behoud backward compatibility binnen een major versie.
- Hergebruik een bestaand veld niet met een andere betekenis.
- Voeg bij nieuwe varianten voorbeelden en contracttests toe.
- Genereer DTO's en clients waar mogelijk uit deze contracten.

## Controle in fase 0

`npm run contracts:check` controleert JSON/YAML-syntax, JSON Schema 2020-12,
lokale schema-/OpenAPI-referenties en de aanwezige synthetische voorbeelden.
Het OpenAPI Example Object gebruikt `externalValue` naar het ongewijzigde JSON-record.
Deze correctie verandert het HTTP-contract of de berichtinhoud niet.
Inhoudelijke LDV-domeinregels en negatieve domeinfixtures volgen in fase 1.
