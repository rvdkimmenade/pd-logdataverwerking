# Fase 5 — Zoekprojectie en Query API

## Doel en uitgangspunt

Fase 4 is voltooid (bdcd5ea, bewijs ea432cd). Opdracht: volgende fase implementeren.
Lever OpenSearch-zoeken vanuit het append-only archief, een geautoriseerde Query
API en een terminaldemo. Geen fase-6-browserconsole of OIDC.

## Ontwerp en grenzen

OpenSearch met vaste image/digest, TLS en clientcertificaatrollen voor projector
en query. Query API gebruikt bestaande mTLS-identiteitsmapping, met afzonderlijk
leesrecht per partij/applicatie. Headers leveren geen identiteit. Archief blijft
gezaghebbend: resultaten worden daar opnieuw opgehaald en op scope gecontroleerd.
Index bevat alleen zoekvelden; originele bytes/envelop worden niet gedupliceerd.

Projector leest periodiek een repeatable-read snapshot in batches, geordend op UUID,
en doet idempotente bulk-upserts. Iedere cyclus scant opnieuw, zodat laat gecommitte
transacties met eerdere timestamps/UUIDs niet worden overgeslagen. Dit is bewust
een begrensde POC-aanpak; geen schaalbaar CDC-resultaat geclaimd. Uitval raakt alleen
projectie. Rebuild gebruikt een nieuwe generatie en atomische aliaswissel, beschermd
tegen gelijktijdige projector/rebuild door een PostgreSQL advisory lock. Oude
generaties blijven beschikbaar tot expliciete lokale opruiming van de teststack.

Zoeken filtert op event/trace/span, tijdvak, bronapplicatie, activiteit en
subjectpseudoniem. Begrensde keysetpagina's; cursor is ondertekend, kort geldig en
gebonden aan filters en scope. Index is eventual consistent; geen snapshots over
meerdere pagina's beloofd. Tracequery retourneert geordende spans, geen browserUI.

Historie via bestaande Register API met uitsluitend reader-toegang en partijscope,
eventtijd en bekende urn:uuid-ID's. De bestaande expliciet lokale registeruitzondering
blijft gelden (loopback HTTP en lokale readercode); geen willekeurige externe URLs
volgen. Niet gevonden wordt expliciet gemarkeerd; registeruitval is 503.

## Contracten, migratie en terugrol

Eerst OpenAPI en request/responsevoorbeeld, daarna service. Nieuwe SELECT-only
databaserollen, geen wijziging van archiefregels of retentie. Nieuwe OpenSearch
generaties veranderen de bron niet. Stoppen behoudt volumes; rollback stopt query
en projector. TLS-config en secrets blijven lokaal en genegeerd.

## Volgorde

1. Contracten, mapping, plan en prestatiedoel.
2. OpenSearch/TLS-infra, beperkte rollen, serviceclient en projector.
3. Query API, cursor, archiefherlezing, registerresolver en demo.
4. Integratie-, scope-, historische-, rebuild-, uitval- en performancetests.
5. Volledige verify, demo, schone checkout en bewijscommit.

## Meetlat en exitcriteria

Lokale POC: 1.000 synthetische records, 30 zoek-/traceverzoeken na warm-up,
p95 maximaal 2.000 ms; projectie binnen 30 seconden na herstel in deze dataset.
Geen productiesizing of SLA. Metingen worden in artifacts/query.json vastgelegd.

- [x] Projector vanuit opgeslagen records en strikte zoekmapping.
- [x] Filteren/pagineren en autorisatie per partij en applicatie.
- [x] Originele records, integriteit en historische registerverrijking.
- [x] Volledige deterministische herbouw na indexverlies.
- [x] OpenSearch-uitval blokkeert archiefopslag niet; herstel haalt in.
- [x] Lag-/rebuildmetrics en begrensde fouten zonder payloads/secrets.
- [x] Synthetische performanceproef haalt meetlat; trace werkt.
- [x] Volledige verify en schone checkout groen.
- [x] Demo, runbook, status, commit; fase 6 niet gestart.

## Voortgang

2026-10-11: fase en goedgekeurde technologie/security gelezen. Geen afwijking van
geaccepteerde architectuur; geplande nieuwe Query API volgt fase 5.

2026-10-12: bestaande fase-5-werkmap hervat. Querygates opgenomen in algemene
verify. Code-/contractcontrole groen: 106 tests, 5 schemas, 3 OpenAPI-contracten.
Contractresolver leest schema-ID's uitsluitend uit lokale bestanden. Extra tests
dekken cursorverval, scopeherlezing, onjuiste indexsortering, registerrol en
projectorfouttelling. Eerste Dockerproef faalde op certificaatrechten bij
OpenSearch; herstel via uitsluitend nodecertificaten in een eigen Docker-volume
wordt geïntegreerd getest. README/runbook en componentdiagram bijgewerkt.

Volledige `npm run verify` geslaagd op 2026-10-12: alle eerdere fasegates en
11 querygates groen. Performance: p95 435 ms, herstelprojectie 609 ms. Lokale
demo toont zoeken, origineel/integriteit, trace en rebuild; registercheck groen.
Opstartrechten en aliasautorisatie hersteld zonder verruiming van queryrechten.
OpenSearch-herstel wacht op beschikbare shards. Een scan start zonder kunstmatige
UUID-ondergrens, zodat ook een later toegevoegd nil-UUID-record wordt gevonden.
Resterend: commit van deze implementatie en verificatie vanuit schone checkout.

Hervatting 2026-10-12: commit `85ffc45` bestaat. De schone checkout van deze
commit bevat een mislukte OpenSearch-uitval/herstelgate; overige fasegates waren
groen. Gerichte herhaling faalt nu bij infrastructuurvoorbereiding doordat Docker
Engine niet draait. Ook na aangevraagde Docker Desktop-start is de enginepipe
niet beschikbaar. Codeverify opnieuw groen (106 tests en contractchecks).
Geen fasevoltooiing: eerst Docker beschikbaar maken, herstelgate onderzoeken,
volledige verify vanuit schone checkout uitvoeren en bewijs vastleggen.

Herhaalproef 2026-10-12: Docker Engine 29.5.3 is bereikbaar. De herstelgate
reproduceerde een tijdelijke OpenSearch HTTP 503 na de clusterhealthcheck.
De proef doet nu begrensde retries uitsluitend voor SearchError 503, overeenkomstig
de herhalende runtimeprojector. De herstelgrens blijft 30 seconden; andere fouten
worden direct doorgegeven. Alle 11 querygates groen: p95 325 ms, laatste
herstelprojectie 605 ms. Codeverify opnieuw groen. Testwijziging gecommit als
`be885ee`; volledige verify loopt vanuit `.local/query-recovery-clean` na
offline installatie uit de npm-cache.

Afgerond 2026-10-12: volledige `npm.cmd run verify` in de schone checkout van
`be885ee` geslaagd. Alle foundation-, register-, ingest-, logboek- en querygates
groen; 106 tests, builds en contractvalidatie groen. Checkoutwerkboom schoon.
Query p95 318 ms; herstelprojectie inclusief retries 924 ms. Bewijs onder
`.local/query-recovery-clean/artifacts/`. Bestaande lokale demo en runbook zijn
aanwezig; status bijgewerkt. Fase 5 voltooid, fase 6 niet gestart.
