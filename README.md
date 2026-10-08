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
- [Implementatieroadmap met fasepoorten](docs/implementation/roadmap.md)
- [Actuele implementatiestatus](docs/implementation/status.md)

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

Fase 0 bevat de technische ontwikkelbasis: TypeScript, configuratievalidatie,
contractcontroles, PostgreSQL, Kafka en een reproduceerbare verificatie. ADR-006,
ADR-007 en ADR-008 zijn op 8 oktober 2026 goedgekeurd. De actuele testbewijzen en
resterende fasepoorten staan in [de implementatiestatus](docs/implementation/status.md).

Er is nog geen Register API, ingestservice, logboekopslag of adminconsole. Die
componenten volgen uitsluitend in hun eigen roadmapfase.

## Technische demo starten

Gebruik Node.js 24 LTS, npm 11.13.0 en Docker met Linux-containers. De
referentiepatch voor Node staat in `.node-version`.

```text
npm ci
npm run demo
```

Dit start PostgreSQL op `127.0.0.1:15432` en Kafka op `127.0.0.1:19092`, voert
een databasequery en een Kafka-roundtrip uit en maakt `artifacts/demo.html`.
Open dat bestand in een browser voor het technische demorapport. Het is een
momentopname van uitgevoerde tests, geen gebruikersapplicatie of live monitor.

```text
npm run infra:check
npm run infra:down
```

Stoppen behoudt de ontwikkelvolumes. Configuratie, geheimen en herstel staan in
het [lokale runbook](docs/runbooks/local-foundation.md). Op Windows PowerShell
kan `npm.cmd` worden gebruikt.

## Verificatie

```text
npm ci
npm run verify
```

Dit is dezelfde opdracht als in CI en omvat ook een geïsoleerde infrastructuurtest
met Kafka-stop/herstart. `npm run verify:code` controleert alleen code en
contracten en is op zichzelf geen volledige fasepoort. De verificatie schrijft
`artifacts/foundation.json` en `artifacts/foundation.html`.
