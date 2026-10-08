# Implementatiestatus

## Huidige fase

**Fase 0 — Fundament en besluiten**

Status op 2026-10-08: **fase 0 voltooid**. De lokale demonstratie, volledige
verificatie, schone checkout en GitHub Actions zijn groen. Fase 1 is niet gestart.

## Menselijke goedkeuring

Roger van de Kimmenade (opdrachtgever), 2026-10-08: 'ik geef goedkeuring voor de 3
voorstellen'. ADR-006, ADR-007 en ADR-008 zijn Accepted, inclusief de begrensde
lokale demo-uitzondering. Er is geen goedkeuring voor een productie-uitrol afgeleid.

## Faseoverzicht

| Fase | Status | Open punten |
| --- | --- | --- |
| 0. Fundament en besluiten | Voltooid | Geen open fase-0-gates |
| 1. LDV-domein en contractvalidatie | Niet gestart; fase-0-poort vrijgegeven | Volgende afzonderlijke opdracht |
| 2. Versioned Verwerkingsregister | Niet gestart | Voorafgaande fasen |
| 3. Ingest API en Kafka | Niet gestart | Retry-identiteit vóór implementatie oplossen |
| 4. Consumer en logopslag | Niet gestart | Voorafgaande fasen |
| 5. Zoekprojectie en Query API | Niet gestart | Voorafgaande fasen |
| 6. Adminconsole | Niet gestart | Voorafgaande fasen |
| 7. Applicatie-outbox | Niet gestart | Voorafgaande fasen |
| 8. Hardening en acceptatie | Niet gestart | Voorafgaande fasen |

## Fase-0-resultaat

- [Goedgekeurde technologie](../decisions/ADR-006-technology-and-repository.md),
  [infrastructuur](../decisions/ADR-007-infrastructure.md) en
  [security](../decisions/ADR-008-authentication-and-authorization.md).
- [Uitvoeringsplan](../../.agent/plans/phase-00-foundation.md).
- [Runbook](../runbooks/local-foundation.md) en [CI-workflow](../../.github/workflows/verify.yml).
- npm-workspace met configuratievalidatie; exacte dependencies en lockfile.
- Gepinde PostgreSQL 18.6- en Kafka 4.3.1-images met digest.
- Technische demo met query, Kafka-roundtrip en geredigeerde HTML/JSON-rapporten.
- Bestaande OpenAPI-exampleverwijzing gecorrigeerd, payload ongewijzigd.

## Uitgevoerd bewijs

Baseline: 99ee227. Geteste implementatiecommit:
`a05201282193e92f1b0ddbc755951b9358bd7c76`, branch `codex/phase-0-foundation`.
De opvolgende bewijsupdate wijzigt uitsluitend documentatie. Artifactpaden hieronder
zijn lokaal gegenereerd en worden niet gecommit.

| Controle | Commando | Uitkomst |
| --- | --- | --- |
| Dependencies | npm install met exacte versies | Lockfile gegenereerd; nul gerapporteerde kwetsbaarheden |
| Formatter/linter/build/tests | npm.cmd run verify:code | Geslaagd; 24 tests in 4 bestanden |
| Contracten | npm.cmd run contracts:check | 6 documenten, 2 schemas, 1 OpenAPI, 5 voorbeelden |
| Technische demo | npm.cmd run demo | Geslaagd; PostgreSQL-query en Kafka-roundtrip |
| Volledige fasepoort lokaal | npm.cmd run verify | Geslaagd, inclusief uitvaldetectie, herstart en cleanup |
| Schone checkout | git clone --no-hardlinks . .local/foundation-clean; daar npm.cmd ci en npm.cmd run verify | Geslaagd; dezelfde 24 tests en alle infrastructuurgates |
| GitHub Actions | npm ci en npm run verify op ubuntu-24.04 / Node 24.21.0 | Geslaagd; [run 37757494324](https://github.com/rvdkimmenade/pd-logdataverwerking/actions/runs/37757494324) |

Lokale omgeving: Windows, Node.js 24.16.0, npm 11.13.0, Docker Engine 29.5.3,
Compose 5.1.4. De Node-referentiepatch voor CI is 24.21.0; package.json ondersteunt
Node 24 vanaf 24.16.0. Dev-dependencies zijn exact vastgezet; typescript-eslint
vereist TypeScript lager dan 6.1, daarom is de compatibele 5.9.3 gebruikt.

De volledige verificatie start een unieke teststack zonder hostpoorten. Na een
positieve databasequery en een synthetische Kafka-roundtrip wordt de broker gestopt.
De healthgate weigert die toestand en wordt na herstart weer groen. Alleen de
unieke teststack en haar volumes worden opgeruimd. De blijvende demo is intact.

Laatste runtimecontrole: `docker ps --filter label=com.docker.compose.project=ldv-foundation-dev`
toont PostgreSQL en Kafka beide healthy, uitsluitend gepubliceerd op respectievelijk
127.0.0.1:15432 en 127.0.0.1:19092. Er is geen webapplicatie op deze poorten.

Rapporten: artifacts/demo.html, artifacts/demo.json, artifacts/foundation.html en
artifacts/foundation.json. Dit zijn momentopnamen van testuitkomsten, geen
gebruikersapp of live monitor. Ze bevatten geen secrets of persoonsgegevens.

## Herstelde fouten

- Kafka kon niet schrijven naar de root-owned named volume. De beperkte initcontainer
  corrigeert uitsluitend de volumeroot; de daadwerkelijke broker draait als UID 1000.
- De OpenAPI Example Object-ref wees naar een kaal record. externalValue verwijst
  nu naar dezelfde fixture; contract- en toolingtests zijn groen.
- De aanvankelijk gekozen ESLint 9 was niet meer ondersteund en is vervangen door
  de compatibele ESLint 10. Er is geen architectuur- of contractafwijking.

## Beperkingen en vervolg

Geen Register API, ingestservice, LDV-opslag of console in fase 0. Geen
productie-authenticatie of HA bewezen. Single-node Kafka en lokaal PLAINTEXT vallen
onder de expliciet goedgekeurde demo-uitzondering. Providerkeuze, productieretentie
en RPO/RTO zijn niet ingevuld. De stabiele retry-identiteit moet vóór fase 3
contractueel worden afgestemd; niet verborgen door foundationtests.
