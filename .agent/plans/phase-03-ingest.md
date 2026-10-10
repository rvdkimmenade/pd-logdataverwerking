# Fase 3 — Ingest API en duurzame acceptatie

## Doel en uitgangssituatie

Fase 2 is voltooid: implementatie dd0e867, bewijscommit 646e93b, volledige verify
ook vanuit een schone checkout groen. De gebruiker vraagt om door te gaan.
Deze fase maakt de route van een geauthenticeerde LDV-aanvraag naar Kafka werkend.

## Besluit vóór uitvoering

De bestaande open vraag over stabiele retry-identiteit is uitgewerkt in ADR-011
en docs/proposals/ingest-retry-contract.md. De voorgestelde ontvangstadministratie
en optionele HTTP-header wijzigen het gedrag/architectuur; daarvoor is akkoord
nodig volgens AGENTS.md. Akkoord is op 2026-10-09 ontvangen: 'ja akkoord'.

## Ontwerp en scope

TypeScript/Fastify, hergebruik @ldv/domain, mTLS-bronnen met expliciete scope,
Kafka-producer met acks=all/idempotentie/retries en veilige metrics. Goedgekeurd:
aparte PostgreSQL-ontvangstmetadata voor stabiele identiteit en conflictcontrole.
Geen LDV-archief, consumer, zoekindex, bedrijfsoutbox of OIDC in deze fase.

## Volgorde en migraties

1. ADR-011 laten beoordelen; concrete clientselectie toetsen tegen Kafka 4.3.1.
2. Bestaande OpenAPI compatibel uitbreiden, AsyncAPI/topiccontract en fixtures.
3. Ontvangstmetadata-migraties en beperkte DB-rol; TLS-configuratie en bronmapping.
4. Ingestvalidatie, autorisatie, producer, foutpaden, health en metrics.
5. Geïsoleerde integratie-/resiliencetests met echte Kafka/DB en certificaten.
6. Demo, runbook, volledige verify, schone checkout, status en commit.

## Deliverables en verplichte poorten

- [x] ADR-011 beoordeeld; retry-identiteit opgelost zonder stil contractverlies.
- [x] POST /v1/log-records volgens contract.
- [x] Authenticatie bronapplicaties en autorisatie per verantwoordelijke.
- [x] Hergebruik validatiebibliotheek fase 1.
- [x] event_id, ontvangsttijd en transportenvelop.
- [x] Kafka-producer met acks=all, idempotentie en retries.
- [x] Correcte acceptatie-, validatie- en beschikbaarheidsresponses.
- [x] Metrics voor ontvangen/geaccepteerd/afgewezen en healthchecks.
- [x] OpenAPI-contracttest.
- [x] Geldige aanvraag tot precies één herkenbaar Kafka-event in normale route.
- [x] Ongeldige logregel bereikt Kafka niet.
- [x] Onbevoegde bron krijgt 403; ongeldige certificaatketen afgewezen.
- [x] Geen succes zonder duurzame acceptatie; uitval geeft 503.
- [x] Geen persoonsgegevens of geheimen in technische logs/fouten.
- [x] Retry-, conflict- en herstartproeven volgens ADR-011.
- [x] Synthetische end-to-enddemo, volledige verify en schone checkout groen.
- [x] Evidence, runbook en consistente commit; fase 4 niet gestart.

## Veiligheid en herstel

Certificaten/secrets in genegeerde lokale bestanden; geen echte gegevens. Runtime
en migratierol gescheiden. Geen automatische destructieve rollback of opschoning
van retry-identiteiten. Geen Kafka-succes suggereren bij onzekere ack. Na code-
rollback metadata behouden; schemaherstel uitsluitend via geteste backupstrategie.

## Voortgang

2026-10-09: ADR-011 geaccepteerd; uitvoering gestart. Kafka-client wordt eerst
tegen de gepinde broker getest; bron- en brokerverbindingen gebruiken mTLS.

Implementatie: apps/ingest, contracts/openapi/ingest-api.yaml,
contracts/asyncapi/ingest-events.yaml, infra/compose.ingest.yaml en scripts/ingest-*.
Client @platformatic/kafka 2.14.0 gepubliceerd met acks=-1/idempotent=true tegen
Kafka 4.3.1. Echte procescrash na ack houdt dezelfde envelop bij retry. Kafka- en
databaseherstel zijn bewezen; runtime kan geen metadata wissen of IDs wijzigen.
Codepoort: 93 tests in 7 bestanden groen. Volledige verify met 15 ingestgates,
foundation en 12 registerchecks groen. Daarna expliciete netwerktimeout toegevoegd:
verify:code en alle 16 ingestgates inclusief stille broker groen. Lokale demo geeft
202 en dezelfde ontvangst bij retry; API draait op 18082.

2026-10-10: schone checkout van implementatiecommit 4ec10d2 in
.local/ingest-clean: npm ci --offline --ignore-scripts en npm run verify volledig
groen, inclusief 93 tests, 12 registerchecks en alle 16 ingestgates. Evidence staat
in docs/implementation/status.md. Fase 3 voltooid; fase 4 niet gestart.

Herstelde bevindingen: Kafka 4.3 gebruikt --command-config; TLS-antwoord 413
vereist een begrensde drain van een te grote body; Kafka-client onderscheidt
broker-timeout en netwerk-requestTimeout (beide expliciet 3 seconden ingesteld).
PKI-generatie gebruikt op Linux de host-UID; containers krijgen alleen hun eigen
certificaatbestanden, nooit de CA-private sleutel of bronprivate sleutels.
