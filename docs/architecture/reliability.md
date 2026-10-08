# Betrouwbaarheid en guaranteed delivery

## Betekenis

Het platform gebruikt **at-least-once aflevering met idempotente verwerking**. Daardoor kan een bericht meer dan eenmaal worden aangeboden, maar wordt een geldige logregel effectief eenmaal opgeslagen.

Een absolute garantie zonder duurzame opslag aan de bron bestaat niet. Daarom is de transactionele outbox het voorkeurspatroon.

## Transactionele outbox

1. De applicatie schrijft de businessmutatie en het LDV-event in één lokale databasetransactie.
2. Een publisher selecteert nog niet bevestigde outboxregels.
3. De publisher verzendt met een stabiele `event_id`.
4. Na bevestigde acceptatie markeert de publisher het event als afgeleverd.
5. Tijdelijke fouten leiden tot retry met begrensde exponential backoff en jitter.

Applicaties zonder database mogen een lokale duurzame spool gebruiken, maar hebben dan geen atomische koppeling tussen businessmutatie en logevent.

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

Meet minimaal outboxleeftijd, publicatiefouten, Kafka consumer lag, rejectratio, dead-lettervolume, databasefouten, indexachterstand en tijd tussen eventtijd en doorzoekbaarheid.
