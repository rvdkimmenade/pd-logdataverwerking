# ADR-008: Authenticatie, autorisatie en veilige demo-configuratie

## Status

Accepted — 2026-10-08. Roger van de Kimmenade heeft de securitykeuzes inclusief de begrensde lokale uitzondering goedgekeurd. Dit document beschrijft een te implementeren grens, geen reeds bewezen beveiliging.

## Context

Bronapplicaties, registerbeheerders en onderzoekers hebben verschillende rechten. Een opgegeven responsible_party of source_application is geen bewijs van identiteit. De architectuur verlangt workload identity of mTLS, gescheiden logstromen en minimale persoonsgegevens.

## Voorgesteld besluit

### Services

Gebruik mTLS voor bronapplicaties en interne serviceverbindingen in de gedeelde/productionele omgeving. Koppel de geverifieerde workload-identiteit aan toegestane bronapplicaties, verantwoordelijken en acties. Vertrouw geen clientheaders met identiteit. Bij TLS-terminatie aan een gateway moet de backend uitsluitend via die vertrouwde gateway bereikbaar zijn; clientaangeleverde identiteitsheaders worden verwijderd en de interne verbinding is geauthenticeerd.

Elke ontvangende API autoriseert de actie zelf. De verantwoordelijke en bron in de technische envelop worden afgeleid van, of gecontroleerd tegen, de geauthenticeerde identiteit. Kafka krijgt ACL's per producer/consumer en topic; databaseaccounts zijn per component begrensd. Een schrijfaccount krijgt geen algemene leesrechten.

### Mensen

Gebruik OIDC bij een bestaande identityprovider voor de latere adminconsole, met Authorization Code en PKCE. Tokens worden gecontroleerd op handtekening, toegestane algoritmen, issuer, audience en geldigheid. Rollen zijn gekoppeld aan verantwoordelijke en waar nodig bronapplicatie. Onbekende identiteit of scope wordt geweigerd. Browsernavigatie is nooit de enige autorisatiecontrole.

De concrete identityprovider volgt de bestaande gemeentelijke voorziening. Geen eigen wachtwoorddatabase. De OIDC-integratie wordt in fase 6 gebouwd; serviceautorisatie begint bij de Register API in fase 2.

### Voorgestelde rechten

| Rol | Toegestane acties binnen toegewezen scope |
|---|---|
| Registerbeheerder | Concepten maken en nieuwe versies voorbereiden |
| Privacy reviewer | Beoordelen en publiceren; geen eigen wijziging zelf goedkeuren |
| Auditor | LDV lezen; export uitsluitend met afzonderlijk exportrecht |
| Technisch beheerder | Technische afleverstatus en geaggregeerde foutinformatie; standaard geen payloadinzage |
| Applicatiebeheerder | Afleverstatus van eigen bronapplicaties; geen algemene LDV-zoekrechten |
| Bronapplicatie | Alleen toegestane verwerkingen aanbieden |

De privacy-reviewer is een applicatierol; deze hoeft niet aan de FG te worden toegewezen. Registerbeheer verleent geen algemene logboekinzage. De API filtert op scope vóór resultaten worden teruggegeven, inclusief traces met meerdere betrokkenen.

### Audit en dataminimalisatie

Registreer publiceren, autorisatiefouten, zoeken en exporteren in een afzonderlijke auditstroom. Gebruikersidentiteit hoort daar, niet in LDV. Log geen tokens, private sleutels, subjectwaarden of volledige request-/responsepayloads in technische logs. Correlatie via technische IDs blijft mogelijk.

De concrete pseudonimisatie-/versleutelingsmethode en sleutelrotatie worden vóór verwerking van echte gegevens apart beoordeeld. De synthetische fase-0-demo introduceert geen eigen cryptografie en claimt geen LDV-compliance voor een gekozen algoritme.

### Expliciete lokale uitzondering

Fase 0 exposeert geen bedrijfs-API of adminconsole. Alleen een geïsoleerde demo op de ontwikkelmachine met synthetische data mag PostgreSQL/Kafka zonder TLS binnen het Compose-netwerk gebruiken. Hostpoorten binden uitsluitend aan loopback. De lokale broker heeft geen productiecredentials. Deze uitzondering is geen toestemming voor een gedeelde testomgeving of echte gegevens.

Genereer eventuele lokale PostgreSQL-secrets willekeurig in een genegeerde configuratie-/secretlocatie. Commit alleen een voorbeeldbestand met variabelenamen en veilige niet-geheime defaults, nooit een bruikbaar wachtwoord of private sleutel. Gebruik in productie een secret manager; ontbrekende verplichte configuratie blokkeert opstarten. Geen automatische terugval naar een demomodus. CI gebruikt tijdelijke secrets en toont hun waarden niet.

## Verificatie en fasering

- Fase 0: configuratietests voor ongeldige omgeving, ontbrekende secrets en verbod op onveilige niet-lokale instellingen; privacycontrole van fixtures en testoutput.
- Fase 2/3: negatieve tests voor ontbrekende identiteit, verkeerde verantwoordelijke/bron en ongeldige certificaatketen; contracten eerst aanpassen aan concrete security schemes.
- Fase 6: OIDC- en roltests, scopefilters op API-niveau, audit van inzage/export en publicatie door een tweede bevoegde rol.
- Fase 8: volledige threat review, sleutelbeheer, bewaarbeleid en herstelproeven.

Geen authenticatie-implementatie of publieke contractwijziging in deze beslisronde. Bestaande security-uitgangspunten blijven van kracht totdat dit voorstel is geaccepteerd. Eventuele wijzigingen aan securitygrenzen vereisen opnieuw goedkeuring.

## Alternatieven en consequenties

API-keys als gedeeld geheim worden niet als voorkeursmodel gekozen: lifecycle en scheiding per bron zijn minder expliciet. OIDC voor gebruikers en mTLS voor workloads vereisen respectievelijk identityprovider- en certificaatbeheer. Die beheerlast is onderdeel van de keuze en wordt niet afgedekt door een lokale demo zonder TLS.

## Goedkeuring

Geaccepteerd door Roger van de Kimmenade (opdrachtgever), 2026-10-08: mTLS voor workloads, OIDC voor mensen, autorisatie op verantwoordelijke/bron/actie, rollenmatrix inclusief publicatiescheiding en uitsluitend de beschreven lokale uitzondering. Bron: bericht 'ik geef goedkeuring voor de 3 voorstellen'.
