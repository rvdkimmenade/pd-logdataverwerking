# Security en privacy

## Goedgekeurde uitwerking

Zie [ADR-008](../decisions/ADR-008-authentication-and-authorization.md), geaccepteerd
op 2026-10-08. De lokale fase-0-demo gebruikt uitsluitend synthetische data en
loopbackpoorten; alleen daar is transport zonder TLS toegestaan. De
foundationcommando's weigeren productie-/gedeelde omgevingen. Hieronder staan de
doelarchitectuureisen; mTLS/OIDC en de rollen worden in de betreffende servicefasen
geïmplementeerd en zijn niet door een infrastructuurdemo bewezen.

## Uitgangspunten

Fase 3 implementeert mTLS voor bron, Kafka (inclusief controller) en
PostgreSQL in de afzonderlijke ingest-demo. Certificaatmapping, topic-ACL's en
een beperkte runtime-databaserol zijn onderdeel van de integratiepoort.
Zie [ingestrunbook](../runbooks/ingest.md). De lokale CA/secretbestanden zijn
ontwikkelmiddelen; productievoorzieningen en sleutelrotatie volgen in fase 8.

- Authenticatie van services met workload identity of mTLS.
- Autorisatie per bronapplicatie, verantwoordelijke en gebruikersrol.
- Versleuteling tijdens transport en in opslag.
- Secrets uitsluitend via een secret manager.
- Minimale gegevensvastlegging en expliciete retentie.
- Append-only opslag en detecteerbare integriteitsschending.
- Audit van beheeracties, zoekopdrachten en exports.

## Rollen adminconsole

Fase 4 gebruikt eigen consumer-, reader- en replaycertificaten en Kafka-ACL's.
Het archief heeft een eigen logische database en owner/writer/readerrollen.
De writer mag alleen de opslagfunctie uitvoeren; de reader wordt uitsluitend
door vertrouwde lokale tooling gebruikt. Party-filtering in de interne query is
geen publieke autorisatiegrens. Een publieke Query API volgt in fase 5.
De beheerder met DDL-rechten blijft vertrouwd; hashes zijn geen cryptografisch
bewijs tegen een beheerder die zowel data als hashes kan vervangen.

Fase 5 voegt een lokale mTLS Query API toe: certificaatfingerprint, leesactie,
verantwoordelijke en bronapplicaties bepalen de scope. Indexhits worden opnieuw
uit het archief gelezen met die scope. Query en projector krijgen afzonderlijke
SELECT-only databaserollen en aparte OpenSearch-certificaten/rechten. Alleen de
projector mag LDV-indexgeneraties aanpassen. De OpenSearch-node ontvangt geen
CA-private sleutel of clientprivate sleutels. Historische verrijking gebruikt
de bestaande lokale registeruitzondering met een readercode per partij;
onbekende activiteit-URL's worden niet gevolgd. Zoekpogingen en weigeringen
krijgen een afzonderlijke auditregel zonder zoekwaarden. Zie het
[zoekrunbook](../runbooks/query.md). OIDC, productie-secretbeheer en gedeelde
inzet worden hiermee niet geclaimd.

| Rol | Rechten |
|---|---|
| Registerbeheerder | Concepten en nieuwe registerversies beheren |
| Privacy officer / FG | Beoordelen, raadplegen en rapporteren |
| Auditor | Alleen lezen en gecontroleerd exporteren |
| Technisch beheerder | Pipeline, fouten en achterstanden bekijken |
| Applicatiebeheerder | Alleen eigen applicaties en afleverstatus |

Specifieke medewerkers worden niet in LDV-logregels opgenomen. Persoonsgebonden gebruikersinformatie hoort in een afzonderlijk auditlog en kan waar toegestaan via `trace_id` worden gecorreleerd.

Exports zijn tijdgebonden, gemarkeerd, geaudit en alleen beschikbaar voor bevoegde rollen.

Fase 6 gebruikt in de lokale console OIDC Authorization Code met S256 PKCE en
state/nonce via Keycloak. RS256-handtekening, issuer, audience en expiratie worden
gecontroleerd. Alleen expliciet geconfigureerde subjects krijgen rollen/scopes.
Tokens blijven server-side; browsercookies zijn Secure, HttpOnly en kortlevend.
De console gebruikt HTTPS en weigert de oude demo-codeauthenticatie. Register-
functies worden met een OIDC-authenticatiemodus hergebruikt; de afzonderlijke
fase-2-reader blijft uitsluitend een lokaal historisch resolverhulpmiddel.
Zie ADR-012 en het consolerunbook voor de begrensde lokale inzet.

Logboekinzage, export, registerbeheer en technische pipeline-inzage zijn aparte
rechten. De consolebackend spreekt Query via begrensde mTLS-scopes. Technische
gebruikers zien uitsluitend metadata van de expliciet gedeelde lokale pipeline,
geen LDV-payloads of subjectwaarden. Een eigen Kafka-certificaat mag fouttopics
lezen en offsetstanden beschrijven, maar niet publiceren. Consoleaudit staat
append-only in register.audit, zonder zoekwaarden/tokens; audituitval blokkeert
inzage en export. Exports zijn gemarkeerde, begrensde geauthenticeerde responses
zonder blijvende downloadlink, met no-store.

Fase 7 gebruikt aparte source_owner/source_app-databaserollen voor de lokale
voorbeeldapplicatie. Runtime mag uitsluitend bronrecords invoegen/lezen en
outbox-aflevermetadata aanpassen; sleutel/payload zijn immutable. De bron heeft
geen connect-/lees-/schrijfrecht op het centrale archief. Ingest gebruikt de
bestaande begrensde mTLS-sourceidentiteit. Businessinput accepteert uitsluitend
synthetische case- en subjectwaarden. Metrics bevatten tellingen, leeftijd en
vaste foutcodes; payloads of medewerkersidentiteit worden niet gelogd.
