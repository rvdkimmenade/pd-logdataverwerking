# Adminconsole en lokale OIDC (fase 6)

## Starten en openen

Node 24, npm 11 en Docker Linux-containers. Uitsluitend synthetische lokale data.

```text
npm ci
npm run console:up
```

Dit start ook register, ingest, logboek, projector en Query API. Console:
https://127.0.0.1:18087. De lokale Keycloak-provider luistert op
https://127.0.0.1:18086. Beide hostpoorten binden uitsluitend aan loopback.
Keycloak 26.8.0 is op digest vastgezet en draait als niet-rootgebruiker. Een
eenmalige initcontainer kopieert alleen de benodigde certificaten en synthetische
realmconfiguratie naar een volume met Linux-rechten; CA-private sleutels worden
niet naar Keycloak gemount.

De demo gebruikt de lokale CA uit `.local/ldv-ingest-dev/pki/ca.crt`. Vertrouw dit
certificaat uitsluitend voor deze lokale demo in je browser. Servicecode
controleert de CA en hostname; certificaatverificatie staat aan. Browsertests
accepteren het lokale testcertificaat, terwijl aparte serviceproeven een verkeerde
CA weigeren. Er is geen wijziging aan het Windows-certificaatregister uitgevoerd.

Synthetische gebruikersnamen en willekeurige wachtwoorden staan in
`.local/ldv-console-dev/toegang.txt`. Open dit bestand lokaal; commit of publiceer
het niet. Gebruik `demo-auditor` om logregels te bekijken en te exporteren.
`demo-investigator` heeft leesrecht zonder exportrecht. De editor, reviewer en
reader zijn uitsluitend registerrollen; `demo-technical` ziet alleen technische
pipeline-informatie. Geen van deze rollen krijgt impliciet logboekrecht.

Inloggen verloopt via OIDC Authorization Code en S256 PKCE met eenmalige,
browsergebonden state/nonce. ID-tokenhandtekening (RS256), issuer, audience en
geldigheid worden gecontroleerd. Tokens blijven op de server. Opaque Secure,
HttpOnly, SameSite=Lax-sessies vervallen uiterlijk na dertig minuten of bij de
ID-tokenexpiratie, afhankelijk van wat eerder is. Uitloggen beëindigt de
consolesessie; de providersessie blijft bestaan. Gebruik een apart browserprofiel
of privévenster om tussen demorollen te wisselen.

## Demo zonder database- of Kafka-tools

1. Log in als auditor. Vul desgewenst trace, periode, applicatie, activiteit of
   subjectpseudoniem in en klik Zoeken. Iedere pagina bevat maximaal 25 resultaten.
2. Details toont originele envelop, opslagmoment, SHA-256 en historisch geldige
   registercontext. De oorspronkelijke bytes blijven beschikbaar via de API.
   Oude fase-4-fixtures met voorbeeld-URL's hebben expliciet unsupported_id.
3. Trace toont afzonderlijke spans, parent-ID, subject en eventtijd. Een parent
   buiten je scope of pagina wordt niet alsnog opgehaald. Meer spans haalt een
   volgende geautoriseerde pagina op; er is geen snapshotclaim.
4. Exporteer deze pagina levert een gemarkeerd JSON-bestand met exportmoment,
   actor, scope en eventuele next_cursor. Het is een begrensde pagina, geen
   verborgen volledige export. Er is geen openbare downloadlink.
5. Registerbeheer is via de navigatie beschikbaar voor registerrollen. De bestaande
   wizard, bewerken, publicatie door een tweede persoon, opvolgers, versieverschillen
   en historische raadpleging worden hergebruikt. Demo-codeauthenticatie wordt op
   de console geweigerd; de vroegere fase-2-service is een afzonderlijk lokaal
   hulpmiddel en wordt door de historische Query-resolver gebruikt.
6. De technische rol opent Pipeline: consumer-offsetachterstand, projectorscanleeftijd
   en maximaal 100 recente reject/dead-lettermetadataregels. Deze rol krijgt geen
   oorspronkelijke payload of subjectwaarde.

## Operationele betekenis en beperkingen

Pipeline is expliciet de gedeelde lokale pipeline, alleen voor een toegewezen
operations-identiteit. Kafka-achterstand is eindoffset minus consumercommit, geen
telling per verantwoordelijke. Verlopen ongelezen offsets worden afzonderlijk
gemarkeerd. De projectorleeftijd is een scanleeftijd, geen exacte ontbrekende
recordtelling. Uitval geeft een fout en geen misleidende nulwaarde.

Fouttopics zijn transport, geen gezaghebbend foutarchief. De metadatafeed leest
opnieuw vanaf het begin van de beschikbare Kafka-retentie en commit geen offsets.
Een begrensde idempotente in-memoryprojectie bewaart maximaal 100 metadataregels;
de status onderscheidt catching_up, caught_up en unavailable. Raw DLQ-payloads
worden niet in deze projectie opgenomen. Herstart herbouwt dit overzicht.
De Kafka-identiteit mag fouttopics lezen en offsetstanden beschrijven, niet
schrijven of LDV-payloads consumeren. Er is geen replayknop in de console.

Menselijke login-, zoek-, detail-, trace-, export- en geweigerde acties worden
in de append-only registeraudit opgeslagen met prefix console.; beheeracties
houden hun bestaande transactionele audit. Er staan geen zoekwaarden of tokens
in audit. Een auditstoring blokkeert inzage/export. Acties beschrijven toegelaten
pogingen; een zoekauditregel is geen succesclaim voor een backendresponse.

Geen productie-HA, gemeentelijke providerintegratie, retentie, backup of outbox
geclaimd. Registerbeheer verleent geen logboekrecht. Configuratie wordt uitsluitend
server-side aan een geverifieerd issuer/subject gekoppeld. Wijziging van rollen,
backendcertificaat of scope is een expliciete configuratiehandeling met herstart.

## Verificatie en terugrol

```text
npm run verify
npm run demo:console
```

verify bevat code-, contract- en OIDC-negatieve tests, alle eerdere fasegates en
test:console. De console-integratieproef gebruikt eigen provider-/database-/Kafka-/
OpenSearch-omgevingen, synthetische historische versies, een parent en twee
betrokkenen, zeven identiteiten, browserflows, scopes, exportaudit en foutstromen.
Alleen deze unieke teststacks worden opgeruimd. Rapport: artifacts/console.json;
browserbeelden: console-test-desktop.png en console-test-mobile.png.

demo:console toetst de zes lokale rollen op de echte provider en APIs. Rapport:
artifacts/console-demo.json. Rechtenfouten, verkeerde CA, tokenhandtekening,
issuer/audience/nonce/state, verlopen sessies, audit- en backenduitval moeten groen
zijn voordat fase 6 voltooid kan worden verklaard. Ook een schone-checkoutproef
en visuele controle zijn vereist; actuele bewijsstatus staat in status.md.

Terugrol stopt console en provider en behoudt register, archief, index en
providerdata. De console kan opnieuw via console:up worden gestart. De console
wijzigt geen LDV-records, gepubliceerde registerversies of Kafka-consumeroffsets.
