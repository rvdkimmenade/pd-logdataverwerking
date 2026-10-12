# ADR-013 — Gecombineerde rollen in de lokale console

Status: Accepted voor lokale demo, expliciet gevraagd door opdrachtgever op
2026-10-12: een admin-gebruiker met alle rollen en het opgegeven demo-wachtwoord.

De console-identiteit krijgt optioneel `roles` naast de bestaande primaire
`role`; bestaande identiteiten en contracten blijven bruikbaar. De vertrouwde
serverconfiguratie kent deze registerrollen toe, niet requestheaders of
browservelden. Logboek-, export- en pipeline-rechten blijven expliciet in
`permissions`; partij- en applicatiescope blijven begrensd. De lokale admin
krijgt alle drie registerrollen en alle vier consolepermissions.

De tweede-persoonpublicatie blijft gelden, ook voor admin: een gebruiker kan
zijn eigen laatst gewijzigde concept niet publiceren. Audit bewaart de eigen
identiteit. Geen Keycloak-beheerrechten voor de consolegebruiker. Geen wijziging
van retentie of LDV-archiefdata; geen productieaccount of productie-wachtwoordbeleid.

Verificatie: echte OIDC-login, alle schermen/acties beschikbaar, directe API-
autorisatie, publicatie door andere identiteit en weigering van eigen publicatie.
