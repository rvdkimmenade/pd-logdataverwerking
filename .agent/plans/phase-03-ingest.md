# Fase 3 — Ingest API en duurzame acceptatie

## Doel en uitgangssituatie

Fase 2 is voltooid: implementatie dd0e867, bewijscommit 646e93b, volledige verify
ook vanuit een schone checkout groen. De gebruiker vraagt om door te gaan.
Deze fase maakt de route van een geauthenticeerde LDV-aanvraag naar Kafka werkend.

## Besluit vóór uitvoering

De bestaande open vraag over stabiele retry-identiteit is uitgewerkt in ADR-011
en docs/proposals/ingest-retry-contract.md. De voorgestelde ontvangstadministratie
en optionele HTTP-header wijzigen het gedrag/architectuur; daarvoor is akkoord
nodig volgens AGENTS.md. Tot akkoord geen runtime- of actief contractwijziging.

## Ontwerp en scope

TypeScript/Fastify, hergebruik @ldv/domain, mTLS-bronnen met expliciete scope,
Kafka-producer met acks=all/idempotentie/retries en veilige metrics. Bij akkoord:
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

- [ ] ADR-011 beoordeeld; retry-identiteit opgelost zonder stil contractverlies.
- [ ] POST /v1/log-records volgens contract.
- [ ] Authenticatie bronapplicaties en autorisatie per verantwoordelijke.
- [ ] Hergebruik validatiebibliotheek fase 1.
- [ ] event_id, ontvangsttijd en transportenvelop.
- [ ] Kafka-producer met acks=all, idempotentie en retries.
- [ ] Correcte acceptatie-, validatie- en beschikbaarheidsresponses.
- [ ] Metrics voor ontvangen/geaccepteerd/afgewezen en healthchecks.
- [ ] OpenAPI-contracttest.
- [ ] Geldige aanvraag tot precies één herkenbaar Kafka-event in normale route.
- [ ] Ongeldige logregel bereikt Kafka niet.
- [ ] Onbevoegde bron krijgt 403; ongeldige certificaatketen afgewezen.
- [ ] Geen succes zonder duurzame acceptatie; uitval geeft 503.
- [ ] Geen persoonsgegevens of geheimen in technische logs/fouten.
- [ ] Retry-, conflict- en herstartproeven volgens ADR-011.
- [ ] Synthetische end-to-enddemo, volledige verify en schone checkout groen.
- [ ] Evidence, runbook en consistente commit; fase 4 niet gestart.

## Veiligheid en herstel

Certificaten/secrets in genegeerde lokale bestanden; geen echte gegevens. Runtime
en migratierol gescheiden. Geen automatische destructieve rollback of opschoning
van retry-identiteiten. Geen Kafka-succes suggereren bij onzekere ack. Na code-
rollback metadata behouden; schemaherstel uitsluitend via geteste backupstrategie.

## Voortgang

2026-10-09: fase-3-ontwerp voorbereid; uitvoering wacht op het concrete ADR-besluit.
