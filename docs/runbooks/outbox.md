# Lokale applicatie-outbox — fase 7

## Demo

Na npm ci en npm run build:

```text
npm run demo:outbox
npm run outbox:status
npm run outbox:worker
```

demo:outbox start de bestaande lokale ingest/consumerketen en maakt twee
synthetische businesscases: één betrokkene (één record) en twee betrokkenen
(parent plus twee children). Beide businessrecords en alle LDV-outboxevents
worden in dezelfde brontransactie opgeslagen. Herhaling behoudt bestaande
cases/events en controleert ingestacceptatie plus unieke archiefrecords.
Bewijs: artifacts/outbox-demo.json; bronconfig uitsluitend in genegeerde .local.
De aparte `source` database staat lokaal in dezelfde PostgreSQL-container als
ingest, maar heeft eigen owner/runtimecredentials. De bron heeft geen centraal
archiefrecht. De publisher gebruikt alleen de HTTPS-ingest-API.

De worker levert voortdurend af; Ctrl+C stopt veilig. Health/metrics op stdout
en IPC geven uitsluitend proces/databasebereikbaarheid, tellingen en leeftijd
van de oudste achterstand. Ready zegt niets over de beschikbaarheid van ingest.
Afgeleverd betekent een valide duurzame ingestacceptatie, geen Query-zichtbaarheid.
De demo bewijst archiefopslag afzonderlijk met een uitsluitend daarvoor bevoegde
reader. Er is geen nieuwe publieke API of webscherm in fase 7.

## Achterstand en herstel

Bij pending/retry en stijgende leeftijd: controleer ingest, certificaten, Kafka
en databasehealth. Transport/timeouts/408/429/5xx blijven retryen met capped
backoff en jitter; sleutels/payloads veranderen niet. Workerherstart hervat
na verlopen leases, ook wanneer de eerdere verzending al was geaccepteerd.
Zet de queue of ingestontvangstadministratie nooit leeg om een fout te verbergen.

Een blocked event duidt op een permanente weigering (zoals 403, 409 of 422).
Bekijk uitsluitend de technische UUID en vaste error_code met bevoegd lokaal
beheer; exporteer geen payloads of secrets. Herstel bronautorisatie of configuratie.
Een payloadcorrectie vereist een nieuw businessbesluit/event, geen mutatie onder
dezelfde sleutel. Na herstel van de oorzaak:

```text
npm run outbox:requeue -- <outbox-uuid>
npm run outbox:worker
```

Requeue werkt uitsluitend op blocked events en behoudt inhoud en UUID.
Delivered events blijven immutable en worden niet opnieuw geopend of verwijderd.
Database-uitval laat de lease en event staan; de worker meldt unavailable en
probeert later opnieuw. Applicatie en publisher mogen alleen hun brondata benaderen.

## Verificatie en herstelstrategie

```text
npm run verify
```

Inclusief unit-/contracttests en test:outbox met echte PostgreSQL, mTLS-ingest,
Kafka en append-only consumer. Tests: rollback, atomic commit, migratie/upgrade,
gelijktijdige leases, ingest-uitval, echte crash na acceptatie, herstart zonder
duplicaten, leasefencing, geblokkeerde events, invalid 202 en veilige output.
Bewijs: artifacts/outbox.json. Alle fixtures zijn synthetisch.

Migratie 001 is herhaalbaar en behoudt data. Terugrol stopt de worker en behoudt
de bron-database inclusief businessrecords, payloads en leases; herstel gebruikt
dezelfde keys. Geen down-migratie die onverzonden events verwijdert. Geen retentie
of automatische opschoning. Garantie geldt bij intacte bronopslag en beschikbaar
herstel van de bestaande keten, binnen ADR-011. Productie-HA, diskverlies,
secretrotatie, backups en deduplicatieretentie worden pas in fase 8 uitgewerkt.
