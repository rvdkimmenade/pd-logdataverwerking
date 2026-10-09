# Fase 2 — Versioned Verwerkingsregister en beheer

## Doel en uitgangssituatie

Fasen 0 en 1 zijn voltooid. Opdrachtgever verplaatst registerbeheer uit fase 6
naar fase 2 en stelt OIDC expliciet uit. ADR-010 legt de lokale demo-grens vast.
Uitkomst: via de browser een activiteit maken, een concept aanpassen, door een
tweede rol publiceren, een nieuwe versie maken en historie/verschillen bekijken.

## Ontwerp, contracten en scope

Eerst OpenAPI en registerschemas; daarna apps/register (Fastify), PostgreSQL-
migraties en statische beheerinterface. Gebruik per verantwoordelijke scoped
queries, beperkte databaserol, onveranderbare publicaties en aparte auditopslag.
Intervallen zijn halfopen, overlap wordt ook in de database geweigerd. Gepubliceerde
einddatums worden niet aangepast. Concepten gebruiken revision voor optimistische
locking. Lokale codes identificeren afzonderlijke editor/reviewer/reader-persona's.
Geen OIDC, productie, Kafka-ingest, logboekzoekschermen of exports in deze fase.

## Volgorde

1. Roadmap/ADR en OpenAPI/schema/voorbeelden vastleggen.
2. Migraties, store, API en lokale sessie-/rol-/scopehandhaving bouwen.
3. Wizard, versiebeheer, vergelijking en historie in de browser bouwen.
4. Synthetische seed, start/stop en isolatie voor tests toevoegen.
5. Unit/contract/database/API/browser/negatieve tests; volledige verify en schone checkout.
6. Runbook, evidence en commits; lokale app starten en tonen.

## Deliverables en verplichte poorten

- [x] OpenAPI voor aanmaken, publiceren, versioneren en raadplegen.
- [x] PostgreSQL-schema en migraties.
- [x] Register API met concept/publicatie, immutable versies en halfopen intervallen.
- [x] Historische query op activiteit-ID en tijdstip.
- [x] Synthetische seeddata en afzonderlijke audit-events.
- [x] Beheerscherm: overzicht, wizard, bewerken, publiceren, opvolger, verschil en historie.
- [x] Lokale codes met rollen, scopes en tweedepersoonspublicatie.
- [x] Nieuwe activiteit en nieuwe versie getest.
- [x] Publicaties immutable, overlap geweigerd, correcte historische versie.
- [x] Autorisatie en tenantisolatie op API en UI getest.
- [x] Migratie op lege database en bij upgrade getest.
- [x] Browserdemo en browsertests per rol groen; labels/toetsenbord/fouten gecontroleerd.
- [x] Volledige verify, schone checkout, runbook en bewijs groen; implementatie dd0e867 en aansluitende bewijscommit.

## Veiligheid, herstel en observatie

Alleen loopback; expliciete lokale modus verplicht. Geen secrets in repository,
browseropslag of technische logs. Health/readiness en tellers zonder payload.
Mutatie plus audit in één transactie, geen succes bij databasefout. Geen destructieve
downmigratie; backup voor upgrade. Tests krijgen een eigen tijdelijke database-
container en ruimen uitsluitend die unieke container/volumes op.

## Voortgang en bevindingen

De goedkeuring om OIDC uit te stellen is ontvangen; geen Keycloak nodig.
API, migraties, lokale codes en beheerscherm zijn gebouwd. De API-/databaseproeven
zijn groen. Twee browserbevindingen zijn hersteld: native datumvelden hebben
meerdere tabstappen; oude succesmeldingen moeten verdwijnen vóór een nieuwe actie
zodat gebruikers/testautomatisering geen verouderde bevestiging lezen. De volledige
verificatie is op 2026-10-09 hervat na de opdracht om door te gaan.

Afgerond op 2026-10-09: lokale volledige verify en dezelfde verify vanuit de
schone checkout dd0e867 groen (90 tests, alle foundationchecks en 12 registerchecks).
De herstelproef stelde vast dat Docker willekeurige poorten na herstart wijzigt;
de eenmaal toegewezen testpoort wordt nu vastgezet. Herstel en databehoud zijn
aangetoond. Desktop/mobiel visueel gecontroleerd, lokale app herstart met behoud
van data en codes. Geen open fase-2-defecten.
