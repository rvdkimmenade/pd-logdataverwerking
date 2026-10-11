# Lokale logboekconsumer (fase 4)

Start met `npm run logbook:up`, daarna `npm run demo:logbook`. De demo verstuurt
een synthetisch record via de echte mTLS-ingest, wacht op archiefopslag en toont
event-ID, opslagmoment en integriteitshash. Registerbeheer blijft op
http://127.0.0.1:18081. Er is in deze fase geen logboekzoekscherm.

Intern raadplegen: `npm run logbook:query -- event_id <uuid> example-municipality`.
Ook trace_id, span_id en processing_activity_id zijn toegestaan. De partij is
verplicht. De lokale CLI toont metadata; de interne reader heeft leesrecht op het
archief en is uitsluitend voor vertrouwde lokale bediening. Publieke autorisatie
en een zoekprojectie volgen in fase 5.

`npm run logbook:down` stopt alleen de consumer. Data en Kafka-offsets blijven
behouden. Herstart met logbook:up. De logbook-database deelt lokaal de beveiligde
PostgreSQL-instance van ingest; owner, writer en reader hebben afzonderlijke rollen.
Writer heeft alleen EXECUTE op de opslagfunctie. UPDATE, DELETE en TRUNCATE worden
ook door triggers geweigerd. Een eigenaar kan DDL uitvoeren en blijft dus vertrouwd.

De consumer commit offsets na databasecommit. Bij herlevering geeft dezelfde
event_id en canoniek identieke envelop geen extra archiefrecord. Afwijkende inhoud
met dezelfde ID wordt afgewezen. Oorspronkelijke bytes, envelop, SHA-256,
opslagmoment en topic/partitie/offset worden bewaard.

Ongeldige JSON/enveloppen en ID-conflicten gaan naar ldv.rejected.v1 met een vaste
reden en hash, zonder onbetrouwbare inhoud. Afhankelijkheidsuitval blijft retryen
met maximaal 30 seconden backoff. Andere technische fouten gaan na drie pogingen
naar ldv.dead-letter.v1 met de gevalideerde oorspronkelijke envelop in Base64.
Offsets gaan pas vooruit na Kafka-bevestiging van die foutstroom.

Na herstel kan `npm run logbook:replay` één dead letter opnieuw aanbieden. De
replayclient controleert contract en hash, publiceert met acks=all en commit daarna
de DLQ-offset. Bij een crash kan herlevering optreden; archiefdeduplicatie blijft
van toepassing. Een lege DLQ leidt tot een begrensde wachttijd en foutmelding.

GET http://127.0.0.1:18083/health toont alleen de processtatus. Dit is geen bewijs
van een bereikbare database of bijgewerkte offsets. GET /metrics en POST /stop
vereisen de lokale controltoken uit de genegeerde configuratie. Metrics bevatten
uitsluitend tellingen. Runtime- en operationele credentials staan gescheiden in
.local/ldv-ingest-dev en horen nooit in versiebeheer.

Verificatie: `npm run test:logbook` start een eigen teststack, doorloopt echte
crashes vóór/na DB-commit, duplicaten, database-uitval, geweigerde rejectpublicatie,
DLQ/replay en beperkte databaserollen. Bewijs: artifacts/logbook.json.
`npm run verify` voert daarnaast alle eerdere fasegates uit.

Uitsluitend synthetische lokale demo, één Kafka-replica. Geen productie-HA,
bewaartermijn of backup-/restoregarantie. Geen automatische verwijdering.
Migratie is herhaalbaar en transactioneel; terugrollen gebeurt door de consumer
te stoppen en de data te behouden.
