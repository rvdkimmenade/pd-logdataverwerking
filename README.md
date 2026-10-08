# Platform Dienstverlening – Logboek Dataverwerkingen

Proof of concept voor een gemeentelijke implementatie van de Logboek Dataverwerkingen (LDV) standaard.

## Doel

Dit project onderzoekt een centraal LDV-platform waarin:

- applicaties asynchroon en betrouwbaar logregels aanbieden;
- Kafka zorgt voor duurzaam transport, buffering en replay;
- het Logboek append-only wordt opgeslagen;
- een aparte zoekindex snelle bevraging mogelijk maakt;
- het Verwerkingsregister versieerbaar en gebruiksvriendelijk is;
- een adminconsole logregels, traces en registerinformatie samenbrengt.

## Belangrijkste ontwerpkeuzes

- Applicaties schrijven niet rechtstreeks naar de centrale logopslag.
- De transactionele outbox is het voorkeursmechanisme voor betrouwbare publicatie.
- Transport is at-least-once; idempotente consumers en `event_id`-deduplicatie leveren effectief eenmalige opslag.
- Kafka is transport, niet het juridische archief.
- Het Verwerkingsregister en Logboek zijn logisch gescheiden componenten.
- LDV-logging, security-/auditlogging en telemetrie blijven afzonderlijke gegevensstromen.
- De zoekindex is een herbouwbare projectie; de append-only opslag is gezaghebbend.

## Documentatie

- [Architectuuroverzicht](docs/architecture/overview.md)
- [Betrouwbaarheid en guaranteed delivery](docs/architecture/reliability.md)
- [Security en privacy](docs/architecture/security.md)
- [LDV-profiel voor de POC](docs/ldv/standard-profile.md)
- [Verwerkingsregister](docs/ldv/processing-register.md)
- [Architecture Decision Records](docs/decisions/README.md)
- [API- en eventcontracten](contracts/README.md)
- [Teststrategie](docs/testing/test-strategy.md)

## Voorgenomen componenten

| Component | Verantwoordelijkheid |
|---|---|
| LDV publisher | Publiceert lokale outboxevents |
| Ingest API | Authenticatie, validatie en acceptatie |
| Kafka | Duurzaam transport, buffering en replay |
| Log consumer | Idempotente verwerking en persistente opslag |
| Logopslag | Append-only bron van waarheid |
| Zoekindex | Snelle zoekprojectie |
| Register API | Versioned beheer en raadpleging |
| Query API | Geautoriseerde samengestelde zoekinterface |
| Adminconsole | Registerbeheer, traceonderzoek en operations |

## Status

Dit repository bevat in eerste instantie het architectuurvoorstel, Codex-instructies, ADR's en contractskeletten. Implementatiekeuzes voor programmeertaal en framework worden als afzonderlijk besluit vastgelegd.
