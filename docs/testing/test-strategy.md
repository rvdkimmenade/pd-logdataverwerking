# Teststrategie

## Testlagen

- Unit tests voor domeinregels, validatie en deduplicatie.
- Contract tests voor OpenAPI, AsyncAPI en JSON Schema.
- Integratietests met Kafka, PostgreSQL en zoekindex.
- End-to-endtests van applicatie-outbox tot adminconsole.
- Resiliencetests met procescrashes en tijdelijke afhankelijkheidsuitval.
- Performancetests voor piekbelasting, ingest latency en zoektijden.
- Securitytests voor authenticatie, autorisatie, tenantisolatie en exports.

## Verplichte betrouwbaarheidsproeven

1. Kafka is tijdelijk niet beschikbaar; events blijven in de outbox.
2. Publisher stopt na verzending maar vóór bevestiging; centrale opslag bevat één record.
3. Hetzelfde `event_id` wordt meermaals aangeboden; opslag blijft uniek.
4. Consumer crasht vóór databasecommit; het event wordt opnieuw verwerkt.
5. Consumer crasht na databasecommit maar vóór offsetcommit; duplicaat is veilig.
6. Zoekindex wordt verwijderd en volledig herbouwd.
7. Registeractiviteit krijgt een nieuwe versie; oude logregels tonen de oude versie.
8. Ongeldig event komt met reden in de rejectstroom.
9. Technische storing veroorzaakt retry en geen functionele afwijzing.

## Acceptatie-indicatoren

Leg voor de POC meetbare doelen vast voor maximale applicatie-overhead, eventverlies (nul binnen het geteste storingsmodel), tijd tot doorzoekbaarheid, herstelduur en maximale querylatency.
