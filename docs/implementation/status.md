# Implementatiestatus

## Huidige fase

**Fase 7 — Applicatie-integratie en transactionele outbox (in uitvoering)**

Start 2026-10-14 op expliciet verzoek, na volledige fase-6-exitgate op a76f686.
Plan: `.agent/plans/phase-07-outbox.md`. Alleen fase 7; fase 8 niet gestart.

Status op 2026-10-12: fase 6 is voltooid op `codex/phase-6-console`, met expliciet
gekozen lokale OIDC-provider voor synthetische gebruikers. Repositorygates,
schone-checkoutbewijs en de lokale zes-rollen-demo zijn groen. De gemelde
automatische herlogin is verholpen en rolwisseling is in dezelfde browser
geverifieerd. Deze beschrijving betreft het fase-6-eindbewijs; fase 7 is op
2026-10-14 gestart zoals hierboven vastgelegd.

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
| 4. Consumer en logopslag | Voltooid | Geen open fase-4-gates |
| 5. Zoekprojectie en Query API | Voltooid | Geen open fase-5-gates |
| 6. Adminconsole | Voltooid | Geen open fase-6-gates |
| 7. Applicatie-outbox | In uitvoering | Implementatie, storingsproeven, demo en schone-checkoutbewijs |
| 8. Hardening en acceptatie | Niet gestart | Voorafgaande fasen |

## Fase-7-voortgang (2026-10-14)

Contract voor synthetische businessinput, bronmigratie, @ldv/publisher,
voorbeeldapplicatie, status/requeue/worker-CLI en outboxrunbook aanwezig.
Negen builds, 132 unit-/contracttests en 26 contractdocumenten groen in de
eerste codeverificatie. Geïsoleerde ketenproeven bewijzen rollback/commit,
migratiebehoud, beperkte DB-rechten, gelijktijdige leases, parent/child en
ingest-uitval zonder verlies. Crash/herstartproef vond PostgreSQL-drivergedrag:
TLS-key wordt non-enumerable en verdween daardoor uit JSON-configuratie.
Helper en lokale configwriter behouden key nu expliciet in genegeerde .local;
worker weigert ontbrekende CA/cert/key. Herproef loopt. Testselectie corrigeert
case binnen een gedeelde W3C-trace; geen tracepropagatieregels veranderd.
Geen fasevoltooiing vóór volledige gates, lokale demo en schone checkout.

Vervolg: alle negen test:outbox-gates groen, inclusief echte continue
workerherstart, procescrash direct na HTTP202, dezelfde ontvangstidentiteit,
één archiefrecord per event, leasefencing, echte HTTP403/blocked/requeue en
invalid202/retry. Bronruntime kan payloads niet wijzigen, data niet verwijderen
of het centrale archief benaderen. Uitvoer bevat geen payloads/credentials.
Lokale demo groen na gecontroleerde herstart van de bestaande consumer:
4 delivered, 0 pending/blocked/leased; één betrokkene één record, twee betrokkenen
drie records. Herhaling behoudt vier attempts en verzendt nul nieuwe events.
De eerste demo had een verouderde readerconfigbestandsnaam; die is gecorrigeerd.
Bewijs: artifacts/outbox.json, outbox-demo.json. Volledige schone verify resteert.

## Fase-6-voortgang (2026-10-12)

### Registerzoekfilters (2026-10-13) — voltooid op 2026-10-14

Eindgate hervat op verzoek van opdrachtgever. Testcontrole toegevoegd vóór de
providerstart: directe QueryService-zoeking levert drie geautoriseerde records
en een geldig responsecontract. Geen runtime-, rechten-, timeout- of retrywijziging.
Geïsoleerde test:console groen; daarna schone checkout van `a76f686` in
`.local/phase6-final-20261014`, offline npm ci en volledige npm run verify groen
(exit 0): 121 tests, alle contractchecks en alle foundation/register/ingest/
archief/query/consolegates. Query p95 667 ms, herstel 1486 ms. Schone werkboom.
Dit sluit de eerdere eindgate af; de historische fouten hieronder blijven
vastgelegd. Geen algemene diagnose/garantie over alle infrastructuurstarts
afgeleid. Bewijs in de artifactmap van deze checkout. Fase 7 is nu toegestaan
op expliciet verzoek van opdrachtgever; fase 8 blijft buiten scope.

Implementatie `9700c8a`: zoeken in naam/activiteit-ID, combineerbare status- en
versieaantalfilters, sorteren op naam of meeste versies, resultaatmelding en
reset. Een geopend detail blijft behouden met melding bij uitsluiting.
De API en geautoriseerde scope blijven ongewijzigd; afspraken staan in
contracts/register-search.md. Geen migratie of fase-7-werk.

Lokale uitrolcorrectie: gebruiker zag op 2026-10-13 nog geen filters. De services
hielden de oude HTML/JavaScript in geheugen vanaf hun start. Uitsluitend de
lokale register- en consoleprocessen herstart; databases/provider behouden.
Directe HTTPS-controle van `/register` en `/app.js` op 18087 en HTTP-root op
18081 bevestigt 200 en alle nieuwe filtervelden. Lokale OIDC-demo opnieuw groen
voor zeven accounts; bijgewerkt adminbeeld toont de filters en is visueel
gecontroleerd. Runbook beschrijft de vereiste serviceherstart.

121 tests, contractchecks, foundation- en registergates groen in werkcheckout
en schone checkout `.local/register-search-clean-20261013` na offline npm ci.
De uitgebreide registerbrowserproef bewijst hoofdletter-/witruimtezoeking,
naam versus ID, concept plus publicatie in één activiteit, gecombineerde
versiefilters, nul resultaten, behouden detail, reset en drie sorteringen.
Desktop- en mobiele screenshots visueel gecontroleerd; lokale OIDC-demo groen
voor alle zeven accounts. Werkmapverify stopte bij query-opstart op PostgreSQL
`57P03` (starting up). Schone-checkoutverify slaagde tot en met alle querygates
(p95 282 ms, herstel 1676 ms), maar de eerste consolezoekproef kreeg HTTP 503.
Alle eerdere gates zijn groen. Geïsoleerde herhaling reproduceerde de 503;
twee diagnostische runs faalden eerder op OpenSearch startup-timeout. Een run
met tijdelijk gepauzeerde lokale demo-provider en zoekindex reproduceerde de
503; uitsluitend vaste foutcodes bevestigden Query API `UNAVAILABLE`, zonder
QueryError-code. Geheugenruimte vrijmaken loste de fout niet op. De laatste
backend-preflight bereikte zijn zoekactie niet door opnieuw een startup-timeout.
Geen runtimewijziging, retryverruiming of testversoepeling toegepast. Tijdelijke
diagnostiek uit de schone checkout verwijderd; lokale demo-services herstart.
De verplichte consolegate is niet betrouwbaar groen. Volgens de roadmapstopregel
stopt deze aanvulling bij de eindgate: de UI is beschikbaar en bewezen, maar geen
volledige afronding of fase-7-start geclaimd. Vervolg: OpenSearch-startup en de
Query API 503 isoleren, daarna de ongewijzigde consolegate groen bewijzen.
Bewijs in de lokale
artifactmappen: register.json, register-desktop/mobile.png en console-demo.json.

### Gecombineerde lokale admin — voltooid

Hervatting van de bestaande fase-6-aanvulling: optionele server-side `roles`
met editor, reviewer en reader, plus alle vier consolepermissions. Partij- en
applicatiescope en tweede-persoonpublicatie blijven gelden (ADR-013).
De geïsoleerde consoleproef omvat admin-login, eigen publicatie weigeren,
publicatie door andere identiteit en gecombineerde beheerknoppen.

Codeverificatie: formatter, lint, zeven builds, 121 tests en alle 24
contractdocumenten groen. De eerste sandboxrun faalde op tijdelijke
Vitest-bestanden; een run buiten de sandbox op twee configuratietimeouts
tijdens gelijktijdige builds. Herhaling zonder die belasting slaagde.
Docker Desktop meldde running terwijl de Linux-enginepipe ontbrak;
herstart herstelde Engine 29.5.3. Volledige `npm run verify` daarna groen:
alle eerdere fasegates en negen consolegates, inclusief acht identiteiten en
de gecombineerde adminpublicatieproef. Query p95 275 ms, herstel 811 ms.

Lokale `demo:console` groen voor alle zeven accounts, inclusief admin en
wachtwoordplicht na logout. Keycloak bleek het aangeleverde nieuwe user-ID
te vervangen; provisioning leest nu het werkelijk opgeslagen ID terug.
Admin-configuratie herladen door uitsluitend het consoleproces te herstarten.
De demo keert na registercontrole terug naar de console voor de logoutcontrole;
het register heeft een anders benoemde OIDC-inloglink. Desktop- en adminbeeld
visueel gecontroleerd. Bewijs: artifacts/foundation.json, console.json,
console-demo.json en console-admin.png.

Eindbewijs gecontroleerd op 2026-10-13: schone checkout van implementatiecommit
`3150a54` in `.local/console-admin-clean-20261012`, `npm ci --offline
--ignore-scripts` en volledige `npm run verify` geslaagd (exit 0).
121 tests, alle contractchecks en foundation-, register-, ingest-, archief-,
query- en negen consolegates groen. Query p95 346 ms over 30 verzoeken;
herstelprojectie 1285 ms, binnen de grenzen 2000/30000 ms. Werkboom van de
schone checkout is schoon. Bewijs staat in de artifactmap van die checkout.
De admin-aanvulling is voltooid. Geen nieuwe GitHub-CI-run of productie-inzet
geclaimd; fase 7 is niet gestart.

### Gemeentelijke demoaanvulling

Op verzoek zijn in a910d0e drie concrete synthetische processen toegevoegd:
Wmo-aanvraag, vergunningaanvraag en paspoortaanvraag voor een minderjarige.
`npm run demo:gemeente` maakt drie registeractiviteiten via de console-API met
OIDC-editor en publiceert via een afzonderlijke reviewer. Twaalf LDV-records gaan
via de bestaande mTLS-ingest/Kafka/consumerketen naar het archief; geen directe
opslagwrites. Lokale demo-sourceautorisatie is aangevuld met uitsluitend deze drie
activiteit-ID's, met behoud van partij/applicatiescope en eerdere activiteit-ID's.

Elk proces heeft een parent en drie child-spans voor twee synthetische betrokkenen.
Alle logdetails tonen de juiste gepubliceerde registerversie 1. Herhaalde demo
houdt vier records per proces en dezelfde event-ID's. Browsercontrole van zoeken,
details, drie traces en de registerlijst groen; screenshots visueel gecontroleerd.
Grondslag/retentie zijn herkenbare demo-invulwaarden; geen echte persoonsdata.

Volledige `npm run verify` groen na deze aanvulling: formatter, lint, zeven builds,
121 tests, 24 contractdocumenten, zes schema's, vier OpenAPI's, twaalf bestaande
fixtures plus validatie van drie gemeentelijke registervoorbeelden en twaalf
gegenereerde LDV-records; alle fundament/register/ingest/logbook/query/consolegates
groen. `verify:code` op de schone checkout van a910d0e eveneens groen. Dit vervangt
de eerdere laatste verify-exit 1 hieronder door een volledige geslaagde run.
Bewijs: artifacts/municipal-demo.json en municipal-{wmo,vergunning,paspoort,register}.png,
plus artifacts/foundation.json. Fase 7 is niet gestart.

Eindbewijs: implementatie da938fc; loginfix 9b3c71a; gecorrigeerde accountwisselproef
dc45fde. `npm run verify` volledig groen in werkcheckout en schone checkout
`.local/console-clean-20261012` op da938fc. Na de loginfix zijn format/lint, zeven
builds, 121 tests, 23 contractdocumenten (zes schema's, vier OpenAPI's, twaalf
fixtures) en alle fundament/register/ingest/archief/querygates opnieuw groen in
de schone checkout. Query: p95 453 ms over 30 metingen, herstel 1036 ms.
De laatste consolepoort faalde eerst omdat de nieuwe proef het gebruikersnaamveld
direct verwachtte; Keycloak toont bij herauthenticatie eerst de eerdere naam en
een wisselicoon. Alleen die testflow en runbook zijn gecorrigeerd, geen verdere
runtimewijziging. De volledige `test:console` herproef op dc45fde is groen met
alle acht gates, inclusief wachtwoordplicht en rolwisseling in dezelfde browser.
De laatste volledige verify-aanroep had dus exit 1; de falende poort is daarna
afzonderlijk hersteld en volledig groen uitgevoerd. Alle gates hebben positief
bewijs. Lokale `demo:console` voor zes rollen met wachtwoordcontrole na logout
eveneens groen. Geen productie- of GitHub-CI-bewijs afgeleid.

Plan: `.agent/plans/phase-06-console.md`. Runbook: [console](../runbooks/console.md).
Lokale providerkeuze bevestigd door opdrachtgever; ADR-012 werkt de geaccepteerde
OIDC-keuze uit. Keycloak 26.8.0 en openid-client 6.8.8 vastgezet. Console op
https://127.0.0.1:18087; provider op https://127.0.0.1:18086. Browsertokens blijven
server-side; Secure/HttpOnly-sessies, PKCE, state/nonce en RS256-tokencontrole.

Zoeken, geautoriseerde originele details en historische context, parent/child-
traceweergave, begrensde gemarkeerde export en pipelinefoutmetadata aanwezig.
Registerbeheer gebruikt de bestaande wizard/API met OIDC-authenticatiemodus.
De console weigert codefallback; de afzonderlijke lokale fase-2-reader blijft
voor historische Query-resolutie behouden. Geen productie-inzet geclaimd.

Eerste positieve bewijs: 15 nieuwe negatieve OIDC/API-tests; geïsoleerde
`test:console` met acht gates groen. Dit bewijst zeven identiteiten, echte
Keycloak-browserlogin, mTLS Query, scope-isolatie, oorspronkelijke bytes/SHA-256,
historische versies, paginering, parent plus twee afzonderlijke betrokkenen,
mobiele layout/toetsenbord/labels, OIDC-registerwijzigingen, publicatie/opvolger/
versieverschil/historie, exportaudit, audituitval, reject/DLQ-metadata, read-only
Kafka-ACL's, verkeerde CA, Origin, backenduitval en logout.
Lokale `demo:console` voor zes rollen eveneens groen; screenshots visueel bekeken.
Bewijs: artifacts/console.json, console-demo.json en console-test-desktop/mobile.png.

Hersteld: Keycloak-certificaatrechten op Windows via uitsluitend noodzakelijke
bestanden in een beperkt Docker-volume; ontbrekende synthetische profielvelden;
historische responsevorm in de UI; mobiele horizontale overflow; contractfixture
voor registerversies. Console controleert ook de scope van backendresultaten.
Fase 6 is nog niet voltooid vóór volledige verify en schone-checkoutbewijs.

## Fase-5-voortgang (2026-10-12)

Query API, ondertekende cursors, OpenSearch-projector, TLS-/rolconfiguratie en
historische registerresolver zijn aanwezig. `npm run verify` is op 2026-10-12
geslaagd: 106 tests in 9 bestanden, zes builds, vijf schemas, drie
OpenAPI-contracten, negen fixtures, foundationproeven, 12 registerchecks,
16 ingestgates, 11 logboekgates en alle 11 querygates.

De zoekproef gebruikt 1.000 synthetische basisrecords plus één herstelrecord:
p95 **435 ms** over 30 zoek-/traceverzoeken na warm-up; projectie na
OpenSearch-herstel **609 ms** (doelen 2.000/30.000 ms). Indexverlies en volledige
deterministische herbouw, mislukte rebuild zonder aliaswissel, lockconcurrentie,
partij-/applicatie-isolatie, historische tijdgrens en registeruitval zijn bewezen.

Lokale Query API op https://127.0.0.1:18084 gestart. Demo bewijst zoeken, detail,
SHA-256-controle, trace en expliciete rebuild op twee bestaande synthetische
records. Register op 18081 blijft bereikbaar. Bewijs: artifacts/query.json,
foundation.json en query-demo-proof.json. Schone checkout is nog te verifiëren.

Hersteld: lokale resolutie van schema-ID's in de contractvalidator;
projectorfouttelling bij databaseverbindingsfouten; controle van indexsortering
tegen het archief. De eerste integratierun vond een OpenSearch-opstartfout door
certificaatbestandsrechten op de Windows-bindmount. Een initcontainer kopieert
uitsluitend de nodecertificaten naar een volume met begrensde Linux-rechten.
Dit herstel is bewezen. Aliasopvragen zijn beperkt tot LDV-indexen;
herstel wacht op beschikbare indexshards. Ook de kleinste geldige UUID wordt
geprojecteerd. Nog geen fasevoltooiing geclaimd vóór de schone-checkoutpoort.

Plan: `.agent/plans/phase-05-query.md`. Runbook: [zoeken](../runbooks/query.md).

Hervatting 2026-10-12: implementatiecommit `85ffc45` is aanwezig en de werkmap
was schoon. De eerdere volledige verify in `.local/query-clean-20261012` van
die commit heeft de querygate voor OpenSearch-uitval/herstel niet gehaald;
foundation-, register-, ingest- en logboekgates slaagden wel. Deze mislukte
schone-checkoutproef is geen voltooiingsbewijs. Een gerichte herhaling kon de
testomgeving niet starten doordat Docker Engine niet beschikbaar is, ook buiten
de sandbox. `docker desktop start` aangevraagd, maar de enginepipe bleef
onbeschikbaar en `docker desktop status` kon geen status ophalen.
`npm.cmd run verify:code` opnieuw geslaagd: 106 tests in 9 bestanden, builds,
formatter, lint en alle contractchecks groen. Blokkade: werkende Docker Engine;
daarna de herstelgate onderzoeken en volledige schone-checkoutverify herhalen.
Fase 5 blijft in uitvoering; fase 6 is niet gestart.

Vervolg op dezelfde dag: Docker Engine 29.5.3 bereikbaar. De herstelgate
reproduceerde een tijdelijke HTTP 503 nadat clusterhealth beschikbaar was.
De test probeert projectie nu opnieuw bij uitsluitend SearchError 503, binnen
de ongewijzigde herstelgrens van 30 seconden; dit volgt het herhalende gedrag
van de runtimeprojector. Geen runtime-, contract- of rechtenwijziging.

**Fase-5-eindbewijs:** testwijziging `be885ee`; nieuwe schone checkout
`.local/query-recovery-clean`, `npm.cmd ci --offline --ignore-scripts` en
`npm.cmd run verify` geslaagd. Werkboom van deze checkout is schoon. Opnieuw
106 tests in 9 bestanden, zes builds, alle contractchecks, foundationproeven,
12 registerchecks, 16 ingestgates, 11 logboekgates en alle 11 querygates groen.
Schone-checkoutmeting: p95 **318 ms** over 30 verzoeken; herstelprojectie
**924 ms**, inclusief eventuele tijdelijke 503-retries (grenzen 2.000/30.000 ms).
Bewijs: `.local/query-recovery-clean/artifacts/foundation.json`, `query.json`,
`register.json`, `ingest.json` en `logbook.json`. Eerder lokaal demobewijs
`artifacts/query-demo-proof.json` toont zoeken, detail, integriteit en trace;
rebuild is ook in beide geslaagde queryproeven bewezen. De eerdere blokkade
is opgelost. Fase 5 is voltooid; geen nieuwe GitHub CI-run of fase-6-start geclaimd.

## Fase-4-resultaat (2026-10-11)

Implementatiecommit `bdcd5ea` op `codex/phase-4-logbook`. Consumer, afzonderlijke
logbook-database, beperkte writer-/readerrollen, append-only bescherming,
integriteitsmetadata, reject/DLQ en expliciete replay zijn geïmplementeerd.
Originele Kafka-bytes en envelop blijven behouden; event_id dedupliceert.

- `npm run verify` geslaagd in de werkmap én in schone checkout
  `.local/logbook-clean` van `bdcd5ea`, na `npm ci --offline --ignore-scripts`.
- Formatter, lint, vijf builds, **97 tests in 8 bestanden**, vier schemas,
  twee OpenAPI-contracten, acht fixtures en tien platformvoorbeelden groen.
- Foundationproeven, **12 registerchecks**, **16 ingestgates** en
  **11 logboekgates** groen vanuit beide checkouts.
- Echte procescrashes vóór DB-commit en na DB-commit vóór offsetcommit,
  duplicaten, ID-conflicten, database-uitval, geweigerde rejectpublicatie,
  technische dead letters/replay, beperkte SQL-rechten en veilige output bewezen.
- Lokale consumer gestart met logbook:up. demo:logbook bewijst ingest → Kafka →
  archief; event `48dfe630-aaa3-40d9-bea6-b3bdf8b7659b`, opgeslagen
  2026-10-11T13:57:34.864Z. Register:check groen; register op 18081 blijft beschikbaar.
- Op aanvullend verzoek tien platformvoorbeelden als concept via de editor-API
  toegevoegd. Tweede import: nul nieuwe activiteiten. Bestaande inhoud behouden.
  Grondslag en retentie zijn nog vast te stellen demonstratietekst.
- Bewijs: artifacts/logbook.json en .local/logbook-clean/artifacts/logbook.json,
  aangevuld met foundation- en registerrapporten. Geen nieuwe GitHub CI-run geclaimd.
- Runbooks: [logboek](../runbooks/logbook.md) en [register](../runbooks/register.md).

Hersteld: strikte schema-eis voor het DLQ-veld; de offsetwaarnemer gebruikt
listCommittedOffsets. Foutpublicatie staat buiten de SQL-retryclassificatie.
Reader-/replaycredentials staan apart van de consumerconfiguratie.

Beperkingen: synthetische lokale demo, één Kafka-replica, vertrouwde lokale
querytooling met expliciete partij. Geen publieke zoekinterface, productie-HA,
retentie of backup-/restoreclaim. Health toont processtatus, geen achterstand.
OIDC blijft fase 6; publieke Query API en zoekprojectie volgen in fase 5.

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
