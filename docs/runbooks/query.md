# Zoeken en Query API (fase 5)

## Starten en demonstreren

Alleen voor synthetische lokale data, Node 24, npm 11 en Docker Linux-containers.
OpenSearch gebruikt een gepinde image, één shard en nul replica's. Reserveer
naast PostgreSQL en Kafka circa 2 GB voor de zoekcontainer.

```text
npm ci
npm run register:up
npm run query:up
npm run demo:logbook
npm run demo:query
npm run query:metrics
npm run query:rebuild
```

`query:up` start ook de bestaande logboekketen. De Query API luistert met mTLS
op `https://127.0.0.1:18084`; dit is een API, geen webscherm. OpenSearch luistert
op `127.0.0.1:19200`. Lokale bediening gebruikt een willekeurig token op poort
18085. Alle sleutels en configuraties staan onder de genegeerde map
`.local/ldv-ingest-dev/query/`; print of commit deze bestanden niet.

`demo:query` zoekt maximaal tien eigen logregels. Per resultaat bevat de response
de originele envelop, de oorspronkelijke bytes als base64, SHA-256,
archieftijd en registercontext. De bestaande logboekfixture gebruikt een
voorbeeld-URL voor de activiteit: deze krijgt expliciet `unsupported_id`.
Voor echte historische verrijking binnen deze demo moet de activiteit-ID een
`urn:uuid:` uit het lokale register zijn. De integratietest maakt en publiceert
twee synthetische versies en bewijst de selectie aan de tijdgrens.

## Contract en toegang

Zie `contracts/openapi/query-api.yaml` en `contracts/schemas/query.schema.json`.
Een geverifieerd clientcertificaat wordt gekoppeld aan leesrecht, verantwoordelijke
en een expliciete lijst bronapplicaties. Onbekende certificaten en scopes worden
geweigerd. Browserlogin/OIDC en zoekschermen volgen pas in fase 6.

- `POST /v1/log-records/search`: filters en optioneel `limit`/`cursor`.
- `POST /v1/traces/{trace_id}`: geordende spans, inclusief originele parentrelatie.
- `GET /v1/log-records/{event_id}`: origineel binnen eigen scope, ook zonder index.

Pagina's zijn oplopend geordend op eventtijd en event-ID. De cursor is vijftien
minuten geldig en gebonden aan identiteit, scope, filters en paginagrootte.
Paginering biedt geen snapshot over meerdere verzoeken. `from` is inclusief,
`until` exclusief; beide gebruiken epochmilliseconden. Er is geen exportendpoint.

Query en projector hebben aparte SELECT-only PostgreSQL-rollen. Alleen de
projector kan indexgeneraties schrijven; de Query API heeft uitsluitend
OpenSearch-zoekrechten. Resultaten worden opnieuw uit het archief gelezen en
gecontroleerd op scope, integriteit en filters. Bij inconsistentie volgt 503.
Registerverrijking gebruikt een lokale readercode per verantwoordelijke;
registeruitval geeft 503 en wordt niet als een lege zoekuitkomst weergegeven.

Audit staat in `audit.jsonl`, gescheiden van LDV en technische logs. Deze bevat
actor, operatie en tijd; outcome 0 betekent een toegelaten zoekpoging, geen
succesclaim. Zoekwaarden, originele records en credentials worden niet geaudit.

## Achterstand en herstel

De projector maakt elke twee seconden een nieuwe scanpoging, met batches van
200 records binnen een PostgreSQL repeatable-read snapshot. Volledige herscans
zijn bewust begrensd tot de POC: ook laat gecommitte records worden zo gevonden.
Dit is geen CDC-oplossing of productieschaalclaim. Kafka-consumptie en archiefopslag
werken onafhankelijk van OpenSearch. Bij uitval blijft de projector opnieuw
proberen en geeft zoeken 503. Na herstel wordt de achterstand ingehaald.

`query:metrics` toont cycli, fouten, aantal geprojecteerde records, rebuildduur en
`scan_lag_ms`: tijd sinds de start van de laatste geslaagde scan. Dit is een
conservatieve scanleeftijd, geen exacte telling van ontbrekende indexrecords.
Vóór de eerste geslaagde scan is de waarde null. `/health` bewijst alleen dat
het API-proces draait; `/metrics` toont API-verzoeken, weigeringen en uitval.
Ook deze API-endpoints vereisen geautoriseerde mTLS.

Rebuild vult een nieuwe generatie vanuit het archief, ververst die en wisselt
de leesalias atomair. Een database advisory lock voorkomt gelijktijdige rebuild
en projectie. Een mislukte rebuild vervangt de bestaande alias niet. Oude of
onvoltooide generaties blijven staan; er is geen automatische retentie/deletie.
Na volledig indexverlies maakt de volgende scan vanzelf een nieuwe generatie.

Stop query en projector met `npm run query:down`. De OpenSearch-container en
volumes blijven behouden. Terugrol naar fase 4 vereist alleen het stoppen van
query/projector; archiefregels, consumer en bestaande API's wijzigen niet.
De nieuwe databaserollen/grants zijn idempotent aangebracht door `prepareQuery`.
Er wordt geen archieftabel gemigreerd of gemuteerd. Eventuele latere verwijdering
van rollen en indexvolumes is een afzonderlijke beheeractie.

## Verificatie

```text
npm run verify
```

De algemene verificatie bevat `test:query`. Voor gericht herhalen: eerst
`npm run build`, daarna `npm run test:query`. De test maakt afzonderlijke
PostgreSQL/Kafka/OpenSearch-omgevingen en ruimt alleen de eigen testvolumes op.
`artifacts/query.json` bevat uitkomsten en performancemetingen.

De POC-meetlat is 1.000 synthetische records, dertig gemeten zoek-/traceverzoeken
na drie warm-upverzoeken, p95 maximaal 2.000 ms, en projectie binnen 30 seconden
na OpenSearch-herstel. Dit is geen productie-SLA. Voor een afgeronde fase zijn
ook volledige verify vanuit een schone checkout en een geslaagde lokale demo vereist; actuele
bewijsstatus staat in `docs/implementation/status.md`.
