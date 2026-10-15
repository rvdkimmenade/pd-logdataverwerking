# Fase 7 — Applicatie-integratie en transactionele outbox

## Doel en situatie

Opdracht 2026-10-14: fase 6 afronden en doorgaan naar fase 7. Fase 6 heeft
volledige schone-checkoutverify op a76f686, met alle gates groen. Dit plan
behandelt uitsluitend fase 7. Een synthetische voorbeeldapplicatie moet bij
businesscommit altijd duurzame LDV-events hebben en achterstand na herstel
volledig afleveren via ingest, Kafka en het append-only archief.

## Scope en ontwerp

Gebruik de vastgelegde TypeScript/PostgreSQL/mTLS-stack, ADR-011 en bestaande
LDV-contracten. Nieuwe bron-database met businessrecord en outbox in dezelfde
transactie; aparte owner/runtimecredentials en geen centraal archiefrecht.
Herbruikbare publisher met stabiele UUID Idempotency-Key, W3C traceparent,
gevalideerde 202-response, timeout, backoff en jitter. SQL-leases met uniek token
en SKIP LOCKED voorkomen gelijktijdige eigenaars; verlopen lease wordt herpakt.
Payload en sleutel blijven immutable. Permanent geweigerde events blijven
zichtbaar geblokkeerd, expliciet herstartbaar; geen automatische verwijdering.
Geen nieuwe publieke REST-API, geen retentie/backup/HA of fase-8-claim.

## Contracten en migratie

Eerst contracts/outbox.md en schema/positieve fixture voor de synthetische
businessinput. Bestaande ingestbody/envelop/API ongewijzigd. Nieuwe migratie
apps/example/migrations/001-outbox.sql; herhaalbare migratieadministratie.
Terugrol: publisher stoppen, brondatabase met pending events behouden en
oude code hervatten; geen drop of verlies van events.

## Stappen

1. Inputcontract en fixtures; publisher/tracecontexttypen.
2. Migratie en transactie/lease-store in voorbeeldapplicatie.
3. Publisheradapter, worker en veilige health/metrics/status-CLI.
4. Geïsoleerde echte ketenproef met procescrashes en synthetische data.
5. Lokale demo, runbook en architectuur/statusdocumentatie.
6. Alle verify-gates, schone checkout, bewijs en consistente commits.

## Deliverables volgens roadmap

- [x] Voorbeeldapplicatie: businessrecord en outbox in één transactie.
- [x] Herbruikbare LDV publisher/adapter.
- [x] Retry, backoff, jitter en afleverstatus.
- [x] Propagatie van W3C Trace Context.
- [x] Voorbeeld met één en meerdere betrokkenen.
- [x] Runbook voor achterblijvende outboxevents.

## Verplichte bewijzen

- [x] Businessrollback maakt ook geen outboxevent.
- [x] Geslaagde businesscommit bevat altijd een outboxevent.
- [x] Ingest-uitval laat events lokaal staan.
- [x] Publishercrash na verzending veroorzaakt geen dubbel archiefrecord.
- [x] Herstart verwerkt achterstand volledig.
- [x] Meerdere betrokkenen: dezelfde trace, unieke child-spans.
- [x] Migratie leeg/upgrade, autorisatie, concurrency en veilige output.
- [x] Volledige verify en alle fasegates vanuit schone checkout.
- [x] Gedocumenteerde demo en bewijs in status.md.

## Exitcriterium

In het gedocumenteerde storingsmodel gaat geen event verloren en de volledige
achterstand wordt na herstel verwerkt. Geen voltooiing op compilatie alleen.
Bij onbetrouwbare gate eerst herstellen, geen fase 8 starten.

## Voortgang en besluiten

Start: voorgeschreven outboxpatroon uitgewerkt met bestaande technologie en
contracts; geen architectuurafwijking of productiebeveiligingsbesluit nodig.

Codechecks: negen builds, 132 tests en 26 contractdocumenten groen in eerste
verify:code na toevoeging van schema/fixture. Eerste ketenproeven bewijzen
rollback, commit, upgrade, beperkte DB-rechten, parent/child en concurrentie.
Testselectie gecorrigeerd voor meerdere cases binnen dezelfde inkomende trace.
Workerherstart vond verloren TLS-key bij JSON-serialisatie: pg maakt key
non-enumerable. Lokale configuraties bewaren die sleutel nu expliciet,
uitsluitend in .local met beperkte rechten. Proef wordt herhaald; geen secrets
in output. Continue workerherstart en echte HTTP 403/invalid 202 toegevoegd.

Alle negen test:outbox-gates groen na het herstellen van key-serialisatie:
echte continue workerherstart leegt achterstand, echte crash na HTTP202 eindigt
op test-crashpunt en hervat dezelfde sleutel, elk event eenmaal in archief.
Leasefencing, 403/blocked/requeue, invalid202/retry en metadata zonder payloads
eveneens bewezen. Demo en volledige schone verify nog open.

Lokale demo groen: 4 delivered, 0 pending/blocked/leased; één persoon heeft één
archiefrecord, twee personen parent plus twee children. Eerste demo gebruikte
een nog niet bijgewerkte readerconfigbestandsnaam; vervolgens bleek de oude
consumer te retryen zonder offsets. Gecontroleerde consumerherstart hervatte
Kafka-achterstand zonder nieuwe outboxevents. Herhaling houdt vier events en
vier attempts, publisher heeft nul nieuwe verzendpogingen. Bewijs outbox-demo.json.
Volledige schone verify resteert.

## Eindbewijs — 2026-10-15

Implementatie 5435f36: schone checkout `.local/outbox-clean-20261014`, offline
npm ci en volledige npm run verify geslaagd (exit 0). Negen builds, 132 tests
in 11 bestanden, zeven schemas, vier OpenAPI's, 13 contractfixtures en alle
foundation/register/ingest/archief/query/console/outboxgates groen.
Query p95 445 ms over 30 verzoeken, herstel 2985 ms (grenzen 2000/30000 ms).

Validatiecorrectie 69beea0 vereist expliciet een string voor receipt.event_id.
Dezelfde schone checkout fast-forward bijgewerkt: verify:code en alle negen
test:outbox-gates opnieuw groen, inclusief een ongeldige array als event_id die
retry blijft en nooit delivered wordt. Werkboom schoon. Alle overige
componenten zijn ongewijzigd sinds de volledige verify. Lokale demo en
herhaling bewezen; runbook, contracten en architectuurdocumenten bijgewerkt.
Bewijs: lokale artifacts/outbox-demo.json, outbox.json en de volledige
artifactmap van de schone checkout. Fase 7 voltooid; fase 8 niet gestart.
