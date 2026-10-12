# ADR-012 — Lokale OIDC-console en server-side sessies

## Status

Uitwerking van Accepted ADR-008/010 binnen fase 6. Opdrachtgever heeft op
2026-10-12 fase 6 gestart en expliciet een lokale demo-provider voor synthetische
gebruikers gekozen. Geen toestemming voor gedeelde of productie-inzet.

## Besluit

Gebruik Keycloak 26.8.0, op containerdigest vastgezet, als lokale OIDC-provider.
Dit is vervangbaar door de bestaande gemeentelijke provider; geen eigen
wachtwoorddatabase in LDV. Console en provider gebruiken TLS en loopbackpoorten.
Het lokale CA-certificaat moet uitsluitend voor deze demo vertrouwd worden;
certificaatverificatie wordt in servicecode nooit uitgeschakeld.

De console is een server-side client (openid-client 6.8.8). Authorization Code
met S256 PKCE, state, nonce en expliciete ID-tokenhandtekeningcontrole, RS256,
issuer/audience/expiratie. Browsergebonden eenmalige logintransacties en Secure
HttpOnly-sessies. Geen access-/ID-tokens of private sleutels naar browsercode.
Rechten worden uit een expliciete configuratie op issuer/subject toegekend;
onbekende gebruikers en door de browser opgegeven rollen worden geweigerd.

Registerbeheer hergebruikt de bestaande store en API-routes met een afzonderlijke
OIDC-authenticatiemodus. De console ondersteunt geen demo-codefallback. De oude
fase-2-hulpmiddelen blijven apart beschikbaar zolang eerdere fasegates die nodig
hebben; zij vormen geen alternatieve ingang op de console. Personen verschijnen
uitsluitend in de aparte auditstroom, nooit in LDV-payloads.

De consolebackend spreekt Query via geverifieerde mTLS en een expliciete scope-
mapping. Browserrequests leveren geen backendcertificaat of scope. Beide API's
autoriseren; menselijke zoek/detail/exportacties krijgen daarnaast consoleaudit.
Exports vereisen afzonderlijk recht en geven een begrensd, gemarkeerd bestand,
zonder openbare of blijvende downloadlink. Auditfouten blokkeren inzage/export.

## Gevolgen en terugrol

Nieuwe consolecontracten zijn aanvullend; bestaande publieke v1-contracten en
archiefdata veranderen niet. Registerconceptwizard, tweede-persoonpublicatie,
versieverschillen en historische resolutie blijven behouden. Stoppen van console
en lokale provider bewaart alle gegevens. OIDC-provider- of backenduitval geeft
een expliciete fout. Productieproviderconfiguratie, HA, retentie en accountbeheer
blijven buiten deze lokale POC-claim.

## Bronnen

- [Keycloak-distributie](https://www.keycloak.org/downloads.html)
- [Keycloak TLS](https://www.keycloak.org/server/enabletls)
- [openid-client OIDC-flow](https://github.com/panva/openid-client/blob/v6.8.8/examples/oidc.ts)
