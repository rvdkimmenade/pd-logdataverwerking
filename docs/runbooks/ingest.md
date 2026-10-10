# Ingest API — fase 3

## Lokale demo

Vereisten: Node 24, npm 11, Docker Linux-containers. Vanuit de repository:

```text
npm ci
npm run ingest:up
npm run demo:ingest
```

De API draait op https://127.0.0.1:18082 en vereist een clientcertificaat. Een
browser zonder certificaat kan deze API niet openen. Het democommando gebruikt
het gegenereerde broncertificaat, stuurt de synthetische fixture tweemaal met
dezelfde Idempotency-Key en toont 202 plus hetzelfde event_id/accepted_at.
De bestaande registerapp blijft bereikbaar op http://127.0.0.1:18081.

Ingest gebruikt eigen Kafka op 127.0.0.1:19094 en PostgreSQL op 127.0.0.1:15434.
De bestaande Kafbat-viewer toont de foundationbroker. Berichten inspecteren in
de ingestbroker (uitsluitend lokale testdata):

```text
docker exec ldv-ingest-dev-kafka-1 /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --command-config /pki/admin.properties --topic ldv.accepted.v1 --from-beginning --max-messages 1 --timeout-ms 10000
```

Stop met `npm run ingest:down`. Dit behoudt volumes, certificaten en ontvangstmetadata.
Opnieuw starten behoudt retry-identiteiten. Wis die metadata niet als herstelactie.
`npm run test:ingest` gebruikt een eigen tijdelijke stack en ruimt alleen haar
containers/volumes op. `npm run verify` omvat ook alle eerdere fasen.

## Acceptatie en fouten

POST /v1/log-records gebruikt de bestaande LDV-body. De optionele UUID-header
Idempotency-Key is uniek binnen bronapplicatie én verantwoordelijke. Gebruik voor
iedere logische logregel een nieuwe sleutel en bewaar deze bij iedere retry.
Een ontbrekende header blijft toegestaan, maar levert bij elke aanvraag een nieuw ID.

202 volgt pas na acks=all én een bevestigde databasecommit. De eerste ontvangst
(event_id, ontvangen tijd, SHA-256) is daarvoor al duurzaam opgeslagen. Een crash
na Kafka-ack kan een dubbel Kafka-bericht veroorzaken met hetzelfde event_id
en created_at. Dit is at-least-once; consumerdeduplicatie wordt in fase 4 gebouwd.
Een reeds bevestigde ontvangst kan bij Kafka-uitval opnieuw bevestigd worden:
die retry veroorzaakt geen nieuwe publicatie.

400: ongeldige JSON/sleutel; 403: certificaat niet gemapt of activiteit buiten scope;
409: dezelfde sleutel met andere inhoud; 413: groter dan 1 MiB; 415: geen JSON;
422: ongeldige LDV-logregel; 503: acceptatie niet bevestigd. Ontbrekende/onvertrouwde
certificaten worden geweigerd vóór HTTP. Identiteitsheaders worden niet vertrouwd.
Fouten bevatten vaste codes en veilige veldpaden.

Canonieke JSON sorteert objectsleutels recursief lexicografisch op UTF-16-codeunits;
arrays behouden hun volgorde. Sleutels/primitieven gebruiken JSON.stringify,
zonder witruimte. Dit is de projectrepresentatie, geen RFC 8785-conformiteitsclaim.
Null accepted_at betekent pending; niet-null betekent accepted. Het ledger bewaart
geen payload, subject-ID of trace-ID. Er is geen automatische expiratie in de POC.

## Beveiliging en beheer

Bronmapping gebruikt de SHA-256-fingerprint van het geverifieerde certificaat en
kent bron, verantwoordelijke en toegestane activiteit-URI's toe. PostgreSQL en
Kafka gebruiken eveneens TLS met clientcertificaten. PostgreSQL vereist bovendien
een eigen runtimewachtwoord; plaintextverbindingen worden geweigerd. De migratierol
beheert het schema. Runtime heeft SELECT/INSERT en UPDATE op accepted_at; een
trigger beschermt bevestigde ontvangsten en ontvangstidentiteit.

Kafka verleent de producer uitsluitend Write/Describe op ldv.accepted.v1 en
IdempotentWrite op de cluster. Administratie gebruikt een apart testcertificaat.
Ook de KRaft-controllerverbinding gebruikt SSL; er is geen anonieme superuser.
Secrets staan onder `.local/ldv-ingest-dev`; commit of deel die bestanden niet.
De lokale CA/certificaten verlopen na 30 dagen. Productie-secretbeheer en rotatie
vallen onder fase 8. De lokale launcher weigert productieconfiguratie en accepteert
uitsluitend synthetische subject-/zaakmarkers; dit is geen algemene PII-detector.

GET /health, /ready en /metrics vereisen een gemapt clientcertificaat. Metrics zijn
proceslokale tellers, zonder bron-/subjectlabels, en resetten bij herstart.
Autorisatiefouten schrijven een afzonderlijk security-event zonder requestinhoud
naar stdout. Requestlogging is uitgeschakeld.

## Herstel en grenzen

@platformatic/kafka 2.14.0 gebruikt acks=-1, idempotent=true, maxInflights=1,
twee retries, 250 ms retrydelay, 3 s requesttimeout en 2 s connecttimeout.
De API wacht de produceroperatie af; er is geen losgekoppelde achtergrondpublicatie
na een eigen Promise.race-timeout. Proeven toetsen publicatie, crash en
stop/herstart tegen de gepinde Kafka 4.3.1.

De lokale broker heeft één replica en min.insync.replicas=1. Dit bewijst
persistentie bij procesherstart, geen tolerantie voor schijfverlies. De
productiebaseline blijft drie brokers/replica's en min.insync.replicas=2.
Kafka is transport; er is nog geen gezaghebbend LDV-archief in deze fase.

Bij rollback van applicatiecode blijft het ontvangstsysteem intact. Voer geen
DROP, TRUNCATE of down --volumes uit op de ontwikkelstack. De eerste migratie is
herhaalbaar. Backup/restore en productieretentie krijgen geteste procedures in
fase 8; er is nu geen bewezen productie-RPO/RTO. Verwijderen van retry-identiteiten
kan dubbele logische events veroorzaken en is geen ondersteunde rollback.
