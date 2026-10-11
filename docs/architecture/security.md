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

| Rol | Rechten |
|---|---|
| Registerbeheerder | Concepten en nieuwe registerversies beheren |
| Privacy officer / FG | Beoordelen, raadplegen en rapporteren |
| Auditor | Alleen lezen en gecontroleerd exporteren |
| Technisch beheerder | Pipeline, fouten en achterstanden bekijken |
| Applicatiebeheerder | Alleen eigen applicaties en afleverstatus |

Specifieke medewerkers worden niet in LDV-logregels opgenomen. Persoonsgebonden gebruikersinformatie hoort in een afzonderlijk auditlog en kan waar toegestaan via `trace_id` worden gecorreleerd.

Exports zijn tijdgebonden, gemarkeerd, geaudit en alleen beschikbaar voor bevoegde rollen.
