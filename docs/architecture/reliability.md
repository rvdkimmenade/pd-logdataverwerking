# Betrouwbaarheid en guaranteed delivery

## Betekenis

Het platform gebruikt **at-least-once aflevering met idempotente verwerking**. Daardoor kan een bericht meer dan eenmaal worden aangeboden, maar wordt een geldige logregel effectief eenmaal opgeslagen.

Een absolute garantie zonder duurzame opslag aan de bron bestaat niet. Daarom is de transactionele outbox het voorkeurspatroon.

## Transactionele outbox

1. De applicatie schrijft de businessmutatie en het LDV-event in één lokale databasetransactie.
2. Een publisher selecteert nog niet bevestigde outboxregels.
3. De publisher verzendt met een stabiele `Idempotency-Key`; ingest bewaart het
   bijbehorende servergegenereerde `event_id` duurzaam volgens ADR-011.
4. Na bevestigde acceptatie markeert de publisher het event als afgeleverd.
5. Tijdelijke fouten leiden tot retry met begrensde exponential backoff en jitter.

Applicaties zonder database mogen een lokale duurzame spool gebruiken, maar hebben dan geen atomische koppeling tussen businessmutatie en logevent.

De fase-7-voorbeeldapplicatie implementeert dit patroon in een afzonderlijke
bron-database. Leases met fencing-token en SKIP LOCKED verdelen werk; een
publishercrash vóór lokale bevestiging leidt tot heraanbieding met dezelfde
sleutel/payload. Alleen gevalideerde 202-acceptatie markeert delivered. Retrybare
fouten behouden pending/retry; permanente weigeringen blijven blocked en kunnen
na oorzaakherstel expliciet worden herstart. Geen event wordt automatisch gewist.
Zie [runbook](../runbooks/outbox.md) en [adaptercontract](../../contracts/outbox.md).

## Kafka-baseline

- Minimaal drie brokers verdeeld over beschikbaarheidszones.
- Replication factor 3.
- `acks=all`.
- `min.insync.replicas=2`.
- Idempotente producers.
- Sleutel op verantwoordelijke plus `trace_id` waar tracevolgorde nodig is.
- Aparte topics voor geaccepteerde, afgekeurde en dead-letter-events.
- Contractversies en compatibiliteitscontrole.

## Consumersemantiek

De fase-4-consumer bewaart originele Kafka-bytes en envelop plus SHA-256 en
ontvangstmetadata in een append-only PostgreSQL-archief. Canoniek identieke
herleveringen zijn duplicaten; dezelfde event_id met andere inhoud geeft een
functionele reject. De originele archiefregel blijft behouden.

Afhankelijkheidsuitval blijft retryen met maximaal 30 seconden backoff. Andere
technische fouten gaan na drie pogingen naar de DLQ. Foutstromen krijgen pas een
source-offsetcommit na bevestigde Kafka-publicatie. Herlevering kan dezelfde
failure_id opnieuw publiceren; afnemers moeten ook daar dedupliceren.
Zie [logboekrunbook](../runbooks/logbook.md) voor expliciete replay en beperkingen.

- Dedupliceer op `event_id` via een unieke databaseconstraint.
- Commit de Kafka-offset pas na duurzame databasecommit.
- Een duplicaat geldt als succesvolle idempotente verwerking.
- Functioneel ongeldige events gaan naar de rejectstroom.
- Technische fouten worden opnieuw geprobeerd en niet als functionele afwijzing geregistreerd.
- Projectie naar de zoekindex mag worden herhaald.

## Storingsscenario's

| Storing | Verwacht gedrag |
|---|---|
| Kafka niet bereikbaar | Event blijft in outbox; gebruikersproces kan afronden |
| Publisher crasht na verzending | Event kan opnieuw komen; consumer dedupliceert |
| Consumer crasht vóór commit | Kafka levert opnieuw |
| Consumer crasht na DB-commit vóór offsetcommit | Duplicaat wordt idempotent verwerkt |
| Zoekindex niet bereikbaar | Logopslag gaat door; projectie wordt later ingehaald |
| Zoekindex verloren | Volledige rebuild vanuit gezaghebbende logopslag |

## Monitoring

De fase-5-projector leest het archief onafhankelijk van de Kafka-consumer.
Herhaalde snapshot-scans in batches leveren idempotente indexdocumenten op
event_id. Een volledige volgende scan neemt ook laat gecommitte records mee;
dit is een begrensde POC-aanpak. OpenSearch-uitval stopt het archief niet.
Rebuild vult een nieuwe generatie en wisselt de leesalias pas na geslaagde
projectie en refresh. Een PostgreSQL advisory lock sluit gelijktijdige
projectie/rebuild uit; mislukking behoudt de bestaande leesalias. Oude generaties
worden niet automatisch verwijderd. Zie het [zoekrunbook](../runbooks/query.md)
voor meetlat, herstel en de betekenis van scanleeftijd.

Meet minimaal outboxleeftijd, publicatiefouten, Kafka consumer lag, rejectratio, dead-lettervolume, databasefouten, indexachterstand en tijd tussen eventtijd en doorzoekbaarheid.
