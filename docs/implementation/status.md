# Implementatiestatus

## Huidige fase

**Fase 3 — Ingest API en duurzame acceptatie (voltooid)**

Status op 2026-10-10: **fase 3 voltooid**. ADR-011 is door de opdrachtgever
goedgekeurd met 'ja akkoord'. Implementatie, contracten, demo en volledige
verificatie vanuit een schone checkout zijn groen. Fase 4 is niet gestart.

## Menselijke goedkeuring

Roger van de Kimmenade (opdrachtgever), 2026-10-08: 'ik geef goedkeuring voor de 3
voorstellen'. ADR-006, ADR-007 en ADR-008 zijn Accepted, inclusief de begrensde
lokale demo-uitzondering. Er is geen goedkeuring voor een productie-uitrol afgeleid.

## Faseoverzicht

| Fase | Status | Open punten |
| --- | --- | --- |
| 0. Fundament en besluiten | Voltooid | Geen open fase-0-gates |
| 1. LDV-domein en contractvalidatie | Voltooid | Geen open fase-1-gates |
| 2. Versioned Verwerkingsregister en beheer | Voltooid | Geen open fase-2-gates |
| 3. Ingest API en Kafka | Voltooid | Geen open fase-3-gates |
| 4. Consumer en logopslag | Niet gestart | Volgende implementatiefase |
| 5. Zoekprojectie en Query API | Niet gestart | Voorafgaande fasen |
| 6. Adminconsole | Niet gestart | Voorafgaande fasen |
| 7. Applicatie-outbox | Niet gestart | Voorafgaande fasen |
| 8. Hardening en acceptatie | Niet gestart | Voorafgaande fasen |

## Fase-3-resultaat (2026-10-10)

Geteste implementatiecommit `4ec10d2` op `codex/phase-3-ingest`.
POST /v1/log-records valideert met @ldv/domain en gebruikt mTLS-bronmapping,
een beperkte PostgreSQL-ontvangstadministratie en een idempotente Kafka-producer.
De optionele Idempotency-Key houdt identiteit stabiel bij retries; conflicten
geven 409. De LDV-body en envelopschema's zijn ongewijzigd.

- Schone checkout `.local/ingest-clean` van `4ec10d2`: `npm ci --offline
  --ignore-scripts` en `npm run verify` geslaagd op 2026-10-10.
- Formatter, lint, vier builds, **93 tests in 7 bestanden**, contractvalidatie,
  foundationproeven en **12 registerchecks** inclusief browserflow groen.
- **16 ingestgates** groen: echte Kafka-publicatie; schema/HTTP-fouten;
  mTLS en scope; gelijktijdige retries; restart; conflicten; crash na ack;
  database- en brokeruitval; stille broker met begrensde wachttijd; herstel;
  Kafka-ACL's; beperkte DB-rechten; veilige metrics/fouten.
- Crash na Kafka-ack veroorzaakt aantoonbaar dezelfde envelop bij retry.
  Dit bewijst at-least-once, geen effectief eenmalige archiefopslag (fase 4).
- Demo op https://127.0.0.1:18082 geeft 202 en een identieke retryresponse.
  Voorbeeldevent: `91b44678-8b3c-4282-bb10-0290c990bb8d`.
- Lokale bewijsbestanden: artifacts/ingest.json en, vanuit de schone checkout,
  .local/ingest-clean/artifacts/ingest.json en foundation.html/json.
- Runbook: [ingest.md](../runbooks/ingest.md). Geen nieuwe GitHub CI-run geclaimd.

Herstelde bevindingen: Kafka 4.3 gebruikt --command-config; een te grote TLS-body
wordt begrensd gedraineerd zodat de 413-response wordt ontvangen; de client krijgt
zowel een expliciete broker-timeout als netwerk-requestTimeout. Containers krijgen
geen CA-private sleutel of bronprivate sleutels. Ook de controller gebruikt TLS.

Beperkingen: uitsluitend synthetische lokale demo, één Kafka-replica; geen HA of
schijfverliesgarantie. Geen ontvangstexpiratie, productie-secretbeheer of
productie-restoreclaim. OIDC voor mensen blijft fase 6. Geen fase-4-consumer of
gezaghebbend logarchief gebouwd.

## Fase-2-resultaat (2026-10-09)

Implementatiecommit `dd0e867` op `codex/phase-2-register`. Register API, migraties,
lokale rol-/scopehandhaving en beheerinterface zijn gebouwd. ADR-010 legt de
goedgekeurde combinatie met beheer en het uitstellen van OIDC vast.

- `npm.cmd run verify` lokaal geslaagd: 90 tests in 6 bestanden; formatter,
  lint, builds, 3 schemas, 2 OpenAPI-contracten en alle foundationproeven groen.
- Alle 12 registerchecks groen: migratie/upgrade, API-contracten, rollen/scopes,
  publicaties, overlap, historie, concurrentie, audittransacties, invoer,
  browserflow, databaseherstel met databehoud en cleanup.
- Desktop- en mobiele screenshots visueel gecontroleerd; de browserflow toetst
  drie rollen, wizard, wijzigingen, publicatie, opvolger, vergelijking en historie.
- Schone checkout van `dd0e867` in `.local/register-clean`: `npm ci --offline
  --ignore-scripts` en `npm run verify` beide geslaagd. Opnieuw 90 tests en alle
  foundation- en registerchecks groen. Geen nieuwe CI-run geclaimd.
- Lokale server na verificatie herstart: http://127.0.0.1:18081 bereikbaar;
  gegevens en toegangscodes behouden.
- Runbook: [register.md](../runbooks/register.md). Bewijs lokaal:
  artifacts/register.html, register-desktop.png en register-mobile.png.

Herstelde bevindingen: locking met beperkte databaserol gebruikt een transactionele
advisory lock; succesmeldingen worden vóór een nieuwe actie gewist; de browsertest
respecteert de segmenten van native datumvelden; de tijdelijke Docker-poort blijft
bij herstart vast zodat het herstel werkelijk op dezelfde verbinding wordt bewezen.

Beperking: lokale synthetische demo, OIDC pas fase 6. Geen claim voor gedeelde of
productie-inzet. Gepubliceerde geldigheidsperiodes blijven immutable, inclusief
een onbegrensde einddatum. Geen logboekzoekschermen of fase-3-ingest geïmplementeerd.

## Fase-1-resultaat

@ldv/domain bevat typen voor logregel, core-attributen, kandidaatvelden, resource
en transportenvelop; AJV-validatie tegen de ongewijzigde JSON Schemas; controles
op tijdvolgorde, exacte getallen en niet-nul-ID's; expliciet synthetisch demobeleid.
Fouten bevatten geen invoerwaarden. Geen netwerk, database of runtime-service nodig.

- `npm.cmd run verify`: geslaagd; formatter, lint, beide TypeScript-builds,
  **81 tests in 5 bestanden**, contractchecks en alle Docker-/uitvalproeven groen.
- Domeindemo via contracts:check: **12 geaccepteerd, 23 terecht afgewezen**.
  Dit omvat de 30 nieuwe complete fixtures en de vijf bestaande voorbeelden.
- Bestaande publieke schemas en OpenAPI zijn ongewijzigd.
- Schone checkout van `b680e28dd4de2c5ea657e0edb873340273821ce4` op branch
  `codex/phase-1-domain` naar `.local/domain-clean`: `npm.cmd ci --offline --ignore-scripts`,
  `npm.cmd run verify:code` en `npm.cmd run demo:domain` geslaagd. Opnieuw alle
  81 tests groen; demo 12 geaccepteerd / 23 terecht afgewezen. De installatie
  gebruikte de lokale cache en deze controles roepen geen infrastructuur aan.
- Deze fase is lokaal geverifieerd en gecommit; geen nieuwe GitHub Actions-run
  geclaimd. De bestaande CI voert dezelfde uitgebreide verify-opdracht uit.

Regels: [validatiecontract](../../contracts/validation.md).
Reproduceren en gebruik: [runbook](../runbooks/domain-validation.md).
Plan: [fase 1](../../.agent/plans/phase-01-domain.md).
De demo-allowlist bewijst geen algemene herkenning of pseudonimisering van
persoonsgegevens. Geen migratie nodig en geen productie-authenticatie toegevoegd.

## Fase-0-resultaat

- [Goedgekeurde technologie](../decisions/ADR-006-technology-and-repository.md),
  [infrastructuur](../decisions/ADR-007-infrastructure.md) en
  [security](../decisions/ADR-008-authentication-and-authorization.md).
- [Uitvoeringsplan](../../.agent/plans/phase-00-foundation.md).
- [Runbook](../runbooks/local-foundation.md) en [CI-workflow](../../.github/workflows/verify.yml).
- npm-workspace met configuratievalidatie; exacte dependencies en lockfile.
- Gepinde PostgreSQL 18.6- en Kafka 4.3.1-images met digest.
- Technische demo met query, Kafka-roundtrip en geredigeerde HTML/JSON-rapporten.
- Bestaande OpenAPI-exampleverwijzing gecorrigeerd, payload ongewijzigd.

## Uitgevoerd bewijs

Baseline: 99ee227. Geteste implementatiecommit:
`a05201282193e92f1b0ddbc755951b9358bd7c76`, branch `codex/phase-0-foundation`.
De opvolgende bewijsupdate wijzigt uitsluitend documentatie. Artifactpaden hieronder
zijn lokaal gegenereerd en worden niet gecommit.

| Controle | Commando | Uitkomst |
| --- | --- | --- |
| Dependencies | npm install met exacte versies | Lockfile gegenereerd; nul gerapporteerde kwetsbaarheden |
| Formatter/linter/build/tests | npm.cmd run verify:code | Geslaagd; 24 tests in 4 bestanden |
| Contracten | npm.cmd run contracts:check | 6 documenten, 2 schemas, 1 OpenAPI, 5 voorbeelden |
| Technische demo | npm.cmd run demo | Geslaagd; PostgreSQL-query en Kafka-roundtrip |
| Volledige fasepoort lokaal | npm.cmd run verify | Geslaagd, inclusief uitvaldetectie, herstart en cleanup |
| Schone checkout | git clone --no-hardlinks . .local/foundation-clean; daar npm.cmd ci en npm.cmd run verify | Geslaagd; dezelfde 24 tests en alle infrastructuurgates |
| GitHub Actions | npm ci en npm run verify op ubuntu-24.04 / Node 24.21.0 | Geslaagd; [run 37757494324](https://github.com/rvdkimmenade/pd-logdataverwerking/actions/runs/37757494324) |

Lokale omgeving: Windows, Node.js 24.16.0, npm 11.13.0, Docker Engine 29.5.3,
Compose 5.1.4. De Node-referentiepatch voor CI is 24.21.0; package.json ondersteunt
Node 24 vanaf 24.16.0. Dev-dependencies zijn exact vastgezet; typescript-eslint
vereist TypeScript lager dan 6.1, daarom is de compatibele 5.9.3 gebruikt.

De volledige verificatie start een unieke teststack zonder hostpoorten. Na een
positieve databasequery en een synthetische Kafka-roundtrip wordt de broker gestopt.
De healthgate weigert die toestand en wordt na herstart weer groen. Alleen de
unieke teststack en haar volumes worden opgeruimd. De blijvende demo is intact.

Laatste runtimecontrole: `docker ps --filter label=com.docker.compose.project=ldv-foundation-dev`
toont PostgreSQL en Kafka beide healthy, uitsluitend gepubliceerd op respectievelijk
127.0.0.1:15432 en 127.0.0.1:19092. Er is geen webapplicatie op deze poorten.

Rapporten: artifacts/demo.html, artifacts/demo.json, artifacts/foundation.html en
artifacts/foundation.json. Dit zijn momentopnamen van testuitkomsten, geen
gebruikersapp of live monitor. Ze bevatten geen secrets of persoonsgegevens.

## Lokale Kafka-viewer (2026-10-08)

Op expliciet verzoek is Kafbat UI v1.5.0 geïnstalleerd als optionele fase-0-tool
volgens ADR-009. De image is op digest vastgezet in infra/compose.viewer.yaml.
Het aparte Compose-project ldv-viewer gebruikt het bestaande Kafka-netwerk.

- `npm.cmd run viewer:up` geslaagd; viewer bereikbaar op http://127.0.0.1:18080.
- HTTP-root geeft 200; `/api/clusters` toont ldv-local ONLINE, één broker en
  `readOnly: true`. `npm.cmd run viewer:check` geslaagd.
- `npm.cmd run verify` opnieuw geslaagd: formatter, lint, build, 24 tests,
  contractchecks en alle geïsoleerde infrastructuur- en uitvalproeven.
- Alleen het interne topic __consumer_offsets aanwezig. Installatie maakt geen
  voorbeeldberichten; de bestaande demoproef ruimt haar tijdelijke topic op.
- Start-, stop- en kijkinstructies staan in README en het lokale runbook.

Deze aanvulling introduceert geen LDV-productconsole of volgende implementatiefase.

## Herstelde fouten

- Kafka kon niet schrijven naar de root-owned named volume. De beperkte initcontainer
  corrigeert uitsluitend de volumeroot; de daadwerkelijke broker draait als UID 1000.
- De OpenAPI Example Object-ref wees naar een kaal record. externalValue verwijst
  nu naar dezelfde fixture; contract- en toolingtests zijn groen.
- De aanvankelijk gekozen ESLint 9 was niet meer ondersteund en is vervangen door
  de compatibele ESLint 10. Er is geen architectuur- of contractafwijking.

## Beperkingen en vervolg

Geen Register API, ingestservice, LDV-opslag of console in fase 0. Geen
productie-authenticatie of HA bewezen. Single-node Kafka en lokaal PLAINTEXT vallen
onder de expliciet goedgekeurde demo-uitzondering. Providerkeuze, productieretentie
en RPO/RTO zijn niet ingevuld. De stabiele retry-identiteit moet vóór fase 3
contractueel worden afgestemd; niet verborgen door foundationtests.
