# LDV-profiel voor de POC

## Referentie

De POC richt zich op Logboek Dataverwerkingen 1.0.0:

<https://gitdocumentatie.logius.nl/publicatie/logboek/dataverwerkingen/1.0.0/>

Controleer bij implementatie altijd de normatieve bron. Dit document beschrijft de lokale toepassing en is geen vervanging van de standaard.

## Componentmapping

| LDV-concept | POC-component |
|---|---|
| Applicatie | Businessapplicatie plus LDV publisher |
| Logboek | Ingest, Kafka-consumer, append-only opslag en Query API |
| Register | Versioned Register API |
| Logregel | LDV-record binnen een technische event envelope |
| Trace | Groepering met `trace_id` |
| Actie | Span met uniek `span_id` |

## Ondersteuning

| Onderdeel | Status | Implementatie |
|---|---|---|
| `trace_id` | Verplicht | Gegenereerd of overgenomen door applicatie |
| `span_id` | Verplicht | Uniek per actie |
| `parent_span_id` | Ondersteund | Relatie met veroorzakende actie |
| `dpl.core.processing_activity_id` | Verplicht bij persoonsdata | Verwijst naar Register |
| Status en tijdstippen | Verplicht | Gevalideerd bij inname |
| Registerversies | Verplicht | Nieuwe versie per relevante wijziging |
| Register-API | Lokale invulling | OpenAPI-contract in dit repository |
| Extensies | Alleen vastgesteld | Geen willekeurige namespaces |

## Lokale technische envelop

De envelop bevat transport- en beheerinformatie die niet automatisch onderdeel is van het normatieve LDV-record:

- `event_id`;
- `schema_version`;
- `source_application`;
- `responsible_party`;
- `created_at`;
- `payload`.

De originele payload wordt onveranderd bewaard. Technische ontvangstmetadata wordt afzonderlijk opgeslagen.
