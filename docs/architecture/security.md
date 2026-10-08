# Security en privacy

## Goedgekeurde uitwerking

Zie [ADR-008](../decisions/ADR-008-authentication-and-authorization.md), geaccepteerd
op 2026-10-08. De lokale fase-0-demo gebruikt uitsluitend synthetische data en
loopbackpoorten; alleen daar is transport zonder TLS toegestaan. De
foundationcommando's weigeren productie-/gedeelde omgevingen. Hieronder staan de
doelarchitectuureisen; mTLS/OIDC en de rollen worden in de betreffende servicefasen
geïmplementeerd en zijn niet door een infrastructuurdemo bewezen.

## Uitgangspunten

- Authenticatie van services met workload identity of mTLS.
- Autorisatie per bronapplicatie, verantwoordelijke en gebruikersrol.
- Versleuteling tijdens transport en in opslag.
- Secrets uitsluitend via een secret manager.
- Minimale gegevensvastlegging en expliciete retentie.
- Append-only opslag en detecteerbare integriteitsschending.
- Audit van beheeracties, zoekopdrachten en exports.

## Rollen adminconsole

| Rol | Rechten |
|---|---|
| Registerbeheerder | Concepten en nieuwe registerversies beheren |
| Privacy officer / FG | Beoordelen, raadplegen en rapporteren |
| Auditor | Alleen lezen en gecontroleerd exporteren |
| Technisch beheerder | Pipeline, fouten en achterstanden bekijken |
| Applicatiebeheerder | Alleen eigen applicaties en afleverstatus |

Specifieke medewerkers worden niet in LDV-logregels opgenomen. Persoonsgebonden gebruikersinformatie hoort in een afzonderlijk auditlog en kan waar toegestaan via `trace_id` worden gecorreleerd.

Exports zijn tijdgebonden, gemarkeerd, geaudit en alleen beschikbaar voor bevoegde rollen.
