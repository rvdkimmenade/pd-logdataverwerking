# Verwerkingsregister met beheerscherm

## Lokaal starten

Vereist: Node 24, npm 11 en Docker met Linux-containers. Alleen synthetische data.

```text
npm ci
npm run register:up
```

Open http://127.0.0.1:18081. De PostgreSQL-container luistert op 127.0.0.1:15433.
De foundationdatabase, Kafka en Kafbat blijven onafhankelijk. register:up maakt
lokale secrets aan in `.local/ldv-register-dev/` en start de server onzichtbaar
op de achtergrond. Een eerste start maakt één synthetisch concept.

De drie willekeurige toegangscodes staan in
`.local/ldv-register-dev/toegangscodes.txt`. Kopieer de code van de gewenste rol
naar het inlogscherm; deel of commit dit bestand niet. Er zijn geen vaste
wachtwoorden in de repository. Sessies verlopen na 30 minuten of een herstart.
De lokale codes identificeren demo-persona's; ze vervangen geen echte IdP.

## Demonstratie

1. Log in met de editor-code. Maak een activiteit via Nieuwe activiteit, vul de
   drie stappen in en sla het concept op. Datums worden in je lokale tijdzone
   getoond en als UTC opgeslagen. Vul een einddatum in voor planbare opvolging.
2. Bewerk het concept en sla op. Er wordt nog niets gepubliceerd.
3. Log uit en log in met de reviewer-code. Selecteer de activiteit en publiceer
   na controle van inhoud en periode. Een eerder bijdragende identiteit mag
   dezelfde versie niet publiceren, ook niet na een rolwissel.
4. Log weer in als editor. Nieuwe versie kopieert de inhoud; kies een aansluitende,
   niet-overlappende periode. Publiceer die daarna als reviewer.
5. Raadpleeg een tijdstip in de eerste periode en vergelijk beide versies.
6. Log in met de reader-code. Raadplegen blijft mogelijk, mutatieknoppen ontbreken
   en de API weigert mutatie ook bij een handmatig verzoek.

Een gepubliceerde versie is inclusief periode onveranderbaar. Zonder einddatum
blijft zij geldig tot oneindig; er kan geen overlappende opvolger komen. Een
verkeerd gekozen gepubliceerde periode kan niet via deze demo worden gecorrigeerd.
Dit gedrag voorkomt impliciete wijziging van historie en staat in ADR-010.
Het overzicht toont maximaal 200 activiteiten binnen de eigen verantwoordelijke.

## Stoppen, controleren en upgraden

```text
npm run register:check
npm run register:down
```

Stoppen behoudt het databasevolume en secrets. Herstart is register:up. Een
herstart wist browsersessies. Na codewijzigingen eerst down, daarna up.
De server weigert productie/gedeelde configuratie; verander de loopbackbinding
niet. OIDC en beveiliging voor gedeelde omgevingen volgen in fase 6.

Maak vóór een migratie een databasebackup met pg_dump via de ownerverbinding;
bewaar die buiten de repository. Genummerde migraties draaien eenmalig, onder
een migratielock en ieder in een transactie. Migratierol en beperkte runtime-rol
zijn gescheiden. Er is geen automatische destructieve downmigratie. Bij problemen
stop je de server, herstel je de backup in een nieuwe database en gebruik je de
bijbehorende codeversie. Test dit vóór echt/gedeeld gebruik; dat is geen fase-2-claim.

## Verificatie en observatie

```text
npx playwright install chromium
npm run verify
```

CI gebruikt `npx playwright install --with-deps chromium`. Voor gerichte tests
na een build: `npm run test:register`. De tests gebruiken een uniek Compose-project
en ruimen uitsluitend dat eigen project en zijn tijdelijke data op. Browser-,
API-, migratie-, concurrency-, autorisatie- en database-uitvalproeven leveren
`artifacts/register.html` en screenshots op. Rapporteer geen lokale toegangscodes.

`/health` toont procesbereikbaarheid, `/ready` databasebereikbaarheid. Na inloggen
geeft `/api/metrics` tellers voor requests, autorisatieweigeringen en mutaties.
Auditmetadata staat append-only in register.audit, gescheiden van LDV-payloads;
mutaties en audit schrijven in dezelfde transactie. Technische serverlogs bevatten
geen requests of credentials. Fouten tonen vaste codes. Bij 503 controleer je
Docker en database, bij 409 ververs je het concept of corrigeer je de periode.

De rollen/scopes en Origin-controle gelden op de API, niet alleen in de browser.
Geen workloadintegratie, productie-TLS, OIDC, logboekinzage, exports of Kafka-events
zijn onderdeel van deze lokale registerfase.
