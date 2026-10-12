# Platform Dienstverlening – Logboek Dataverwerkingen

Proof of concept voor een gemeentelijke implementatie van de Logboek Dataverwerkingen (LDV) standaard.

Gemeentelijke demo's: start de console en voer `npm run demo:gemeente` uit voor
Wmo-, vergunning- en paspoortaanvragen. Dit voegt drie gepubliceerde synthetische
registeractiviteiten en twaalf doorzoekbare logregels toe. Zie het
[consolerunbook](docs/runbooks/console.md) voor rollen en kijkinstructies.

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

Het register met beheer en de Ingest API zijn beschikbaar. Fase 4 voegt de
append-only logboekopslag toe. Fase 5 voegt OpenSearch en de Query API toe.
Start met `npm run register:up` en `npm run query:up`, en zoek met
`npm run demo:query`. Zie het [zoekrunbook](docs/runbooks/query.md) voor
autorisatie, historische verrijking, herstel en de actuele verificatie-eisen.

De fase-6-console wordt gestart met `npm run console:up` en is bereikbaar op
https://127.0.0.1:18087. Deze gebruikt een lokale OIDC-provider met synthetische
gebruikers en biedt logboekzoeken, traceonderzoek, details, export en operationeel
inzicht. Gebruikersgegevens staan in het genegeerde lokale toegangbestand.
Zie het [consolerunbook](docs/runbooks/console.md) voor login, rollen en demo.

Gebruik `npm run register:examples` voor tien platformgerelateerde concepten.
Start de consumer met `npm run logbook:up` en toon POST → Kafka → archief met
`npm run demo:logbook`. Zie het [logboekrunbook](docs/runbooks/logbook.md).

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

## LDV-domeinvalidatie (fase 1)

```text
npm run demo:domain
```

Deze demo controleert logregels en transportenveloppen zonder Docker, netwerk of
database. De bibliotheek valideert schema's, tijdvolgorde en ID's, met een optioneel
beleid voor synthetische identificatoren. Zie het [runbook](docs/runbooks/domain-validation.md)
en [validatiecontract](contracts/validation.md).

## Verwerkingsregister en beheer

Het **Verwerkingsregister met beheerscherm** start je met `npm run register:up`.
Open <http://127.0.0.1:18081>; lokale toegangscodes en de demonstratieroute staan in
het [registerrunbook](docs/runbooks/register.md). OIDC volgt op verzoek in fase 6.
Stop met `npm run register:down`; data blijft behouden.

## Kafka-viewer

De beveiligde Ingest API start met `npm run ingest:up`. Voer vervolgens
`npm run demo:ingest` uit voor een synthetische aanvraag en identieke retry.
Zie het [ingestrunbook](docs/runbooks/ingest.md) voor mTLS, berichtinzage en herstel.
De ingestbroker is apart van onderstaande foundation-viewer.

Kafka inspecteren kan met de optionele Kafbat UI:

```text
npm run viewer:up
```

Open <http://127.0.0.1:18080> en kies **ldv-local → Topics → Messages**.
Stop de viewer met `npm run viewer:down`, vóór het stoppen van de foundationstack.
De viewer is alleen lokaal en staat in alleen-lezenmodus.

## Verificatie

```text
npm ci
npm run verify
```

Dit is dezelfde opdracht als in CI en omvat ook een geïsoleerde infrastructuurtest
met Kafka-stop/herstart. `npm run verify:code` controleert alleen code en
contracten en is op zichzelf geen volledige fasepoort. De verificatie schrijft
`artifacts/foundation.json` en `artifacts/foundation.html`.
