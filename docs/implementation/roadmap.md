# Implementatieroadmap

## Doel en werkwijze

Deze roadmap bouwt het LDV-platform op in kleine, aantoonbaar werkende verticale stappen. Codex werkt aan maximaal één fase tegelijk. Een volgende fase begint pas nadat alle exitcriteria van de huidige fase aantoonbaar zijn gehaald.

Voor iedere fase:

1. maak of actualiseer een ExecPlan in `.agent/plans/`;
2. implementeer uitsluitend de genoemde deliverables;
3. voer unit-, contract-, integratie- en waar nodig resiliencetests uit;
4. herstel fouten voordat nieuwe functionaliteit wordt toegevoegd;
5. leg testcommando's, uitkomsten en resterende risico's vast in `status.md`;
6. commit code, contracten, migraties en documentatie als één consistente wijziging.

## Algemene definitie van gereed

Iedere fase voldoet minimaal aan:

- bouw, linting en tests werken vanaf een schone checkout;
- geen secrets of echte persoonsgegevens in code, fixtures of logs;
- interfaces komen overeen met OpenAPI, AsyncAPI en JSON Schema;
- databasewijzigingen hebben een migratie en terugrol- of herstelstrategie;
- fouten worden zichtbaar gemaakt en niet stil genegeerd;
- relevante metrics en health checks zijn aanwezig;
- README en runbook beschrijven hoe het resultaat lokaal wordt gestart en bewezen;
- `status.md` bevat reproduceerbaar bewijs.

## Fase 0 — Fundament en besluiten

### Doel

Maak de repository uitvoerbaar en leg technologiekeuzes vast voordat servicecode ontstaat.

### Deliverables

- ADR voor programmeertaal, framework, buildtool en repository-indeling.
- ADR voor lokale en productie-infrastructuur.
- ADR voor authenticatie en autorisatie.
- Werkende projectscaffolding met formatter, linter, testframework en dependency locking.
- Lokale omgeving met PostgreSQL, Kafka en waar nodig OpenSearch.
- Eén commando voor build en verificatie, bij voorkeur `make verify`.
- CI-workflow die dezelfde verificatie uitvoert.
- Configuratie via environment variables met veilige demo-defaults.

### Verplichte tests

- Schone checkout kan bouwen.
- Unit-testvoorbeeld slaagt.
- Contractbestanden worden syntactisch gevalideerd.
- Lokale infrastructuur start en health checks worden groen.
- CI voert dezelfde checks uit.

### Exitcriterium

Technologie- en security-ADR's zijn door een mens geaccepteerd. Alle foundationchecks zijn groen.

## Fase 1 — LDV-domein en contractvalidatie

### Doel

Maak van de bestaande contracten uitvoerbare regels zonder netwerk- of databaseafhankelijkheid.

### Deliverables

- Domeintypen voor logregel, attributes, resource en transportenvelop.
- JSON Schema-validatie.
- Semantische validatie: eindtijd niet vóór starttijd, geldige status, ID-formaten en vereiste persoonsdata-attributen.
- Expliciete scheiding tussen LDV Core en kandidaatvelden `dpl.pd.*`.
- Positieve en negatieve fixtures.
- Contracttest die alle voorbeelden valideert.

### Verplichte tests

- Geldig demo-object wordt geaccepteerd.
- Ontbrekende core-attributen worden afgewezen.
- Ongeldige trace- of span-ID wordt afgewezen.
- Ruwe identificatoren in aangewezen demo-tests worden door beleidsvalidatie geweigerd.
- Eindtijd vóór starttijd wordt afgewezen.
- Transportenvelop valideert alleen met een geldige payload.

### Exitcriterium

De validatiebibliotheek heeft geen infrastructuur nodig en alle contracttests zijn groen.

## Fase 2 — Versioned Verwerkingsregister

### Doel

Lever eerst een zelfstandig bruikbaar Register met historische versies.

### Deliverables

- OpenAPI-contract voor aanmaken, publiceren, versioneren en raadplegen.
- PostgreSQL-schema en migraties.
- Register API met concept- en publicatiestatus.
- Immutable gepubliceerde versies met `valid_from` en `valid_until`.
- Query op activiteit-ID en tijdstip.
- Eenvoudige seeddata met uitsluitend synthetische voorbeelden.
- Audit-event voor registerwijzigingen, gescheiden van LDV-logregels.

### Verplichte tests

- Nieuwe activiteit en nieuwe versie kunnen worden gemaakt.
- Gepubliceerde versie kan niet worden gewijzigd.
- Geldigheidsintervallen mogen niet overlappen.
- Historische query levert de destijds geldige versie.
- Autorisatie voorkomt ongeoorloofde mutaties.
- Migratie werkt op een lege database en bij upgrade.

### Exitcriterium

Een demo toont aanmaken, publiceren, versioneren en historische raadpleging. API- en integratietests zijn groen.

## Fase 3 — Ingest API en duurzame acceptatie

### Doel

Accepteer een LDV-logregel volgens het contract en publiceer een technisch event duurzaam naar Kafka.

### Deliverables

- Implementatie van `POST /v1/log-records`.
- Authenticatie van bronapplicaties en autorisatie per verantwoordelijke.
- Hergebruik van de validatiebibliotheek uit fase 1.
- Generatie van `event_id`, ontvangsttijd en transportenvelop.
- Kafka-producer met `acks=all`, idempotentie en retries.
- Correcte HTTP-responses voor acceptatie, validatie- en beschikbaarheidsfouten.
- Metrics voor ontvangen, geaccepteerde en afgewezen verzoeken.

### Verplichte tests

- Contracttest tegen OpenAPI.
- Geldige logregel resulteert in exact één herkenbaar Kafka-event.
- Ongeldige logregel bereikt Kafka niet.
- Onbevoegde bron krijgt 403.
- Bij onmogelijke duurzame acceptatie volgt 503 en geen succesrespons.
- Geen persoonsgegevens verschijnen in applicatielogs of foutmeldingen.

### Exitcriterium

Een synthetisch request kan aantoonbaar tot Kafka worden gevolgd en alle foutpaden zijn getest.

## Fase 4 — Log consumer en append-only opslag

### Doel

Verwerk Kafka-events betrouwbaar en sla iedere geldige logregel effectief één keer op.

### Deliverables

- Kafka-consumer met expliciet offsetbeheer.
- PostgreSQL append-only logtabellen en migraties.
- Unieke constraint op `event_id`.
- Rejectstroom voor functioneel ongeldige events.
- Retry en dead-letter-beleid voor technische fouten.
- Query op event-, trace-, span- en processing-activity-ID.
- Integriteit- en ontvangstmetadata zonder de originele payload te wijzigen.

### Verplichte resiliencetests

- Consumercrash vóór databasecommit leidt tot herlevering.
- Crash na databasecommit maar vóór offsetcommit creëert geen duplicaat.
- Herhaald event met dezelfde `event_id` is idempotent.
- Tijdelijke database-uitval veroorzaakt retry, geen functionele reject.
- Permanent ongeldig event komt met reden in de rejectstroom.
- Geaccepteerde records kunnen niet via normale API's worden gewijzigd of verwijderd.

### Exitcriterium

De volledige route van POST via Kafka naar append-only opslag werkt en alle crashscenario's zijn groen.

## Fase 5 — Zoekprojectie en Query API

### Doel

Maak logregels snel doorzoekbaar zonder de zoekindex als bron van waarheid te gebruiken.

### Deliverables

- OpenSearch-projector vanuit opgeslagen events.
- Indexmapping voor trace, span, periode, applicatie, activiteit en subject-pseudoniem.
- Query API met filtering, paginering en autorisatie.
- Verrijking met de historisch geldige registerversie.
- Rebuildcommando vanuit append-only opslag.
- Index-lag en rebuildmetrics.

### Verplichte tests

- Zoekresultaat verwijst naar het originele opgeslagen record.
- Autorisatie isoleert verantwoordelijken en applicaties.
- Historische registerinformatie wordt op eventtijd geselecteerd.
- Verwijderde index wordt volledig en deterministisch herbouwd.
- Tijdelijke OpenSearch-uitval blokkeert logopslag niet.
- Performanceproef gebruikt uitsluitend synthetische data.

### Exitcriterium

Zoeken en traceweergave werken binnen de vastgelegde POC-latency en een volledige indexrebuild is bewezen.

## Fase 6 — Adminconsole

### Doel

Lever een bruikbare interface voor registerbeheer, onderzoek en operationeel inzicht.

### Deliverables

- Inloggen en rolgebaseerde navigatie.
- Registerwizard, publicatie en versieverschil.
- Zoeken op trace, periode, applicatie, activiteit en subject-pseudoniem.
- Tracetijdlijn met parent-childrelaties.
- Detailweergave van originele logregel plus historische registerversie.
- Schermen voor rejects, dead letters en pipelineachterstand.
- Audit van zoekopdrachten, exports en beheeracties.

### Verplichte tests

- Component- en end-to-endtests per rol.
- Onbevoegde informatie is niet zichtbaar of direct opvraagbaar.
- Meerdere betrokkenen verschijnen als afzonderlijke child-spans.
- Versieverschillen en historische context zijn correct.
- Export is geautoriseerd en geaudit.
- Basiscontrole op toegankelijkheid en toetsenbordbediening.

### Exitcriterium

Een gebruiker kan de volledige synthetische demo uitvoeren zonder database- of Kafka-tools.

## Fase 7 — Applicatie-integratie en transactionele outbox

### Doel

Bewijs guaranteed delivery vanaf een voorbeeldapplicatie, inclusief lokale storingen.

### Deliverables

- Voorbeeldapplicatie met businessrecord en outbox in één transactie.
- Herbruikbare LDV publisher/adapter.
- Retry, backoff, jitter en afleverstatus.
- Propagatie van W3C Trace Context.
- Voorbeeld met één en meerdere betrokkenen.
- Runbook voor achterblijvende outboxevents.

### Verplichte resiliencetests

- Businessrollback maakt ook geen outboxevent.
- Geslaagde businesscommit bevat altijd een outboxevent.
- Ingest-uitval laat events lokaal staan.
- Publishercrash na verzending veroorzaakt geen dubbel opgeslagen record.
- Herstart verwerkt achterstand volledig.
- Meerdere betrokkenen krijgen dezelfde trace en unieke child-spans.

### Exitcriterium

In het gedocumenteerde storingsmodel gaat geen event verloren en de volledige achterstand wordt na herstel verwerkt.

## Fase 8 — Security, beheer en POC-acceptatie

### Doel

Maak de keten aantoonbaar beheersbaar en geschikt voor een formele POC-beoordeling.

### Deliverables

- Threat model en security review.
- Retentie-, archiverings-, backup- en herstelprocedure.
- Dashboards en alerts voor outbox, Kafka, consumer, opslag en index.
- Load- en duurtest.
- Herstelproef en gedocumenteerde RPO/RTO.
- Software Bill of Materials en dependency scan.
- POC-demonstratiescript en eindrapport met beperkingen.

### Verplichte tests

- Autorisatie- en tenantisolatietests.
- Backup/restore en disaster-recoveryoefening.
- Loadtest op afgesproken piekvolume.
- Geen verlies tijdens broker- of consumeruitval binnen het storingsmodel.
- Secret- en dependency-scans.
- Handmatige privacy- en architectuurreview.

### Exitcriterium

Alle acceptatiecriteria in `acceptance-matrix.md` hebben bewijs, bekende beperkingen zijn vastgelegd en een menselijke eigenaar heeft de POC geaccepteerd.

## Stopregels

Codex stopt bij de fasegrens wanneer:

- een architectuur- of technologiebesluit menselijke goedkeuring vereist;
- een verplichte test niet betrouwbaar groen wordt;
- contract en gewenste implementatie elkaar tegenspreken;
- echte persoonsgegevens of productiecredentials nodig lijken;
- een volgende fase nodig lijkt om een fout in de huidige fase te verbergen.

In dat geval wordt de blokkade in `status.md` vastgelegd en niet omzeild.
