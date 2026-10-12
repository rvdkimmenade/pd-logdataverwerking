# Fase 6 — Adminconsole

## Doel en huidige situatie

Opdracht 2026-10-12: start fase 6, met een lokale OIDC-provider voor synthetische
gebruikers (expliciete gebruikerskeuze). Fase 5 is voltooid met schone-checkoutbewijs
van be885ee. Registerbeheer staat in apps/register; zoeken/detail/trace zijn
beschikbaar via de mTLS Query API. Er is nog geen browserlogboek.

## Scope en constraints

Uitsluitend fase 6: OIDC, consoleonderzoek, operationele weergaven en exportaudit.
Geen applicatie-outbox, retentiebeleid, productie-inzet of fase-7-deliverables.
Hergebruik TypeScript/Fastify en de bestaande HTML/CSS/JavaScript-registerinterface.
Geen nieuw frontendframework. Respecteer ADR-008 en ADR-010: rollen op de API,
registerbeheer geeft geen logboekrecht, tweede persoon publiceert, synthetische
data en loopback. Browser ontvangt geen workloadcredentials of OIDC-tokens.

## Ontwerp

Lokale Keycloak-provider, vastgepinde image/digest, willekeurige lokale credentials
in .local, uitsluitend synthetische identiteiten. Console gebruikt server-side
Authorization Code, S256 PKCE, state/nonce, geverifieerde ID-tokenhandtekening,
issuer/audience/expiratie en een expliciete serverconfiguratie per subject.
Kortlevende HttpOnly-sessies; mutaties controleren Origin. Geen identiteit uit
headers. Een consolebackend hergebruikt registerfuncties en spreekt de Query API
via mTLS met begrensde scopes. Audit van menselijke acties staat los van LDV.
Concrete implementatiekeuzes en eventuele afwijkingen worden afzonderlijk vastgelegd.

## Contracten en migraties

Eerst console-OpenAPI en schema's voor sessie, zoeken, detail, trace, export en
operationeel overzicht. Bestaande v1-contracten blijven compatibel. OIDC wordt
een aanvullende registerauthenticatiemodus; legacy fase-2-demo is geen console-
fallback. Geen wijziging van LDV- of archiefpayloads. Eventuele operationele
projectie is rebuildable; migraties krijgen afzonderlijk herstelbewijs.

## Uitvoering

1. Contracten, rollenmatrix en lokale providerconfiguratie.
2. OIDC-client, sessies en registerintegratie, negatieve authenticatietests.
3. Zoekscherm, paginering, originele details en historische registercontext.
4. Tracetijdlijn met parent/child en meerdere synthetische betrokkenen.
5. Geautoriseerde export, rejects/dead letters en pipelineachterstand.
6. API-, component- en browsertests per rol, toegankelijkheidscontrole.
7. Volledige verify, lokale demo, schone checkout, status en bewijscommit.

## Verificatie en exitcriteria

- [x] OIDC Authorization Code met PKCE vervangt demo-toegang in de console.
- [x] Rollen bepalen navigatie én directe API-toegang.
- [x] Zoeken op trace, periode, applicatie, activiteit en subjectpseudoniem.
- [x] Parent-child-tracetijdlijn met afzonderlijke spans per betrokkene.
- [x] Originele logregel plus historisch geldige registerversie.
- [x] Rejects, dead letters en pipelineachterstand zichtbaar voor bevoegde rol.
- [x] Zoekopdrachten, exports en beheeracties geaudit, geen zoekwaarden/tokens.
- [x] Component- en end-to-endtests per rol groen.
- [x] Onbevoegde informatie ook direct niet opvraagbaar.
- [x] Versieverschillen en historische context correct.
- [x] Export geautoriseerd en geaudit.
- [x] Labels, toetsenbordbediening en foutmeldingen gecontroleerd.
- [x] Volledige synthetische demo zonder database-/Kafka-tools.
- [x] Volledige verify én schone-checkoutbewijs, documentatie en implementatie eens.

## Betrouwbaarheid, security en terugrol

IdP-uitval geeft expliciete fout, geen demo-loginfallback. State is kortlevend,
eenmalig en browsergebonden. Sessies vervallen uiterlijk met token en worden bij
logout verwijderd. Onbekende subjects/rollen/scopes worden geweigerd. Backenduitval
geeft 503; nooit een misleidend leeg resultaat. Auditfouten blokkeren inzage/export.
Terugrol stopt console/provider en behoudt register/archief/index en lokale volumes.
Geen secrets of echte persoonsgegevens in fixtures, testoutput of Git.

## Voortgang en bevindingen

2026-10-12: fase gestart; opdrachtgever koos lokale demo-provider. Architectuur,
security, ADR-006/008/010, contracts/AGENTS.md en bestaande services gelezen.
Geen fasevoltooiing geclaimd.

Eerste implementatie: apps/console, aanvullend console-OpenAPI/schema, bestaande
registerauthenticatie als expliciete OIDC-modus. Provider en frontend HTTPS;
backend mTLS. Consoleaudit in bestaande append-only registeraudit; geen nieuwe
archief- of registermigratie. Technische metadatafeed is in-memory/rebuildable,
maximaal 100 regels, zonder raw DLQ-payloads en zonder offsetcommit. Eigen Kafka-
certificaat/ACL's, expliciet globaal lokaal pipeline-overzicht voor technische rol.

15 OIDC/API-tests groen; acht geïsoleerde integratiegates groen met zeven
identiteiten, echte browserlogin, oorspronkelijke bytes/historie, drie spans,
mobiele layout en OIDC-registerflows. Lokale demo voor zes rollen groen.
Keycloak-volumerechten, synthetische profielvelden, historische UI-responsevorm,
mobiele overflow en versionfixture hersteld. Volledige verify gestart;
schone-checkoutpoort en bewijscommit nog open. Fase 7 niet gestart.

Volledige verify groen op implementatiecommit da938fc, zowel in de werkcheckout
als in `.local/console-clean-20261012` (121 tests en alle integratiegates).
Gebruikersmelding over automatische herlogin verwerkt in 9b3c71a: OIDC
`prompt=login` vereist nieuwe authenticatie, zonder tokens aan browsercode te
geven. Lokale zes-rollen-demo bevestigt na logout het lege wachtwoordveld in
dezelfde browsercontext. De geïsoleerde browserproef controleert bovendien
rolwisseling na logout. Definitieve verify voor deze fix loopt nog.

Afgerond 2026-10-12: de herhaalde verify op 9b3c71a slaagde tot en met query;
alleen de nieuwe rolwisselproef faalde op het ontbrekende gebruikersnaamveld.
Keycloak vereist eerst zijn accountwisselicoon; proef en runbook gecorrigeerd in
dc45fde. Daarna volledige test:console in de schone checkout groen (acht gates),
inclusief wachtwoordplicht en andere identiteit in dezelfde context. Alle gates
groen; de laatste volledige verify-exit 1 en de geslaagde gerichte herproef zijn
expliciet vastgelegd in status.md. Geen verdere runtimewijziging na de verify.
Lokale console draait met loginfix, zes demorollen gecontroleerd. Fase 7 niet gestart.

## Aanvulling gemeentelijke demo's (2026-10-12)

Opdrachtgever vraagt concrete Wmo-, vergunning- en paspoortvoorbeelden. Dit blijft
fase 6: bestaande register-/console-/ingestinterfaces gebruiken, geen outbox of
nieuwe API's. Nieuwe contractfixtures bevatten uitsluitend synthetische processen;
grondslag en retentie zijn herkenbare demo-invulwaarden, geen juridische claims.
Uitvoering: drie activiteiten aanmaken via OIDC-editor, publiceren via afzonderlijke
OIDC-reviewer, twaalf records via bestaande mTLS-ingest publiceren en via console
historische context/trace verifiëren. Bestaande gegevens behouden. Herhaling gebruikt
dezelfde ontvangstidentiteiten. Alleen lokale demo-source krijgt de drie expliciete
activiteit-ID's erbij; geen wildcard of verruiming van partij-/applicatiescope.

- [x] Fixtures en register-/LDV-validatie.
- [x] Drie gepubliceerde activiteiten en twaalf doorzoekbare records lokaal.
- [x] Herhaling zonder duplicaten, browseronderzoek en registerweergave.
- [x] Repositoryverificatie en bewijs in status.md.

Afgerond op a910d0e: drie activiteiten via afzonderlijke OIDC-editor/reviewer
gemaakt/gepubliceerd en twaalf records via ingest, Kafka en archief naar de
console. Alle details resolven registerversie 1. Herhaling behoudt vier records
per activiteit en dezelfde event-identiteiten. Browser controleert de drie
registeritems en alle tracetijdlijnen; screenshots bekeken. Eerste demo-proeven
hersteld voor het synthetische case-ID-beleid, UUID-idempotentiesleutels en wachten
op nieuwe schermresultaten. Volledige npm run verify groen, inclusief alle acht
consolegates. Verify:code op schone checkout eveneens groen met 121 tests en
validatie van drie registervoorbeelden/twaalf records. Geen interfacewijzigingen,
nieuwe dependencies, directe archiefwrites of volgende-fasewerk.

## Aanvulling gecombineerde demo-admin (2026-10-12)

Opdrachtgever vraagt expliciet een lokale gebruiker admin met het opgegeven
demo-wachtwoord en alle rollen. ADR-013 beschrijft de aanvullende optionele
`roles`-lijst; bestaande primaire rollen blijven compatibel. Rollen worden
uitsluitend server-side toegekend. Alle vier consolepermissions, dezelfde partij
en applicatiescope. Tweede-persoonpublicatie blijft verplicht, ook voor admin.
Provisioning gebruikt de Keycloak-beheer-API met een tijdelijke service-identiteit
die na afloop wordt verwijderd; gebruikers en realm blijven behouden. Wachtwoord
alleen in genegeerde lokale configuratie, niet in code of fixtures.

- [x] Contract eerst aangevuld, gecombineerde API- en UI-autorisatie.
- [x] Lokale providergebruiker aangemaakt, tijdelijke provisioning-identiteit verwijderd.
- [x] Echte browserlogin met zeven lokale gebruikers en admin-acties.
- [x] Geïsoleerde adminproef: eigen publicatie weigeren, andere identiteit publiceren.
- [ ] Volledige verify, schone checkout en bijgewerkt statusbewijs.
