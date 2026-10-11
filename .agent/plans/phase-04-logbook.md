# Fase 4 — Consumer en append-only logopslag

## Doel en uitgangssituatie

Fase 3 is voltooid: implementatie 4ec10d2, bewijs 12b2120; alle gates vanuit
schone checkout groen. Opdracht: volgende fase. Het register is al beschikbaar
op 18081 (register:check geslaagd). Deze fase maakt POST → Kafka → archief werkend.

## Scope en ontwerp

Consumer op ldv.accepted.v1 met expliciete offsetcommit na databasecommit.
PostgreSQL-database logbook, logisch gescheiden van ingest en register; eigen
migratie-, writer- en readerrollen. Lokale database deelt de beveiligde
ingest-PostgreSQL-instance. Geen publieke Query API, zoekindex of OIDC in deze fase.

Bewaar de oorspronkelijke Kafka-value als bytes, de ongewijzigde envelop als
JSONB, SHA-256, ontvangstmoment en herkomstoffset. event_id is uniek; canoniek
identieke envelop is idempotent, botsende inhoud wordt afgewezen zonder mutatie.
Writer gebruikt uitsluitend een beperkte SECURITY DEFINER-insertfunctie en heeft
geen algemene lees-, update- of deleterechten. Triggers verbieden ook truncate.
Interne querymodule/CLI ondersteunt event-, trace-, span- en activiteit-ID, altijd
met expliciete verantwoordelijke. Publieke autorisatie/queryverrijking blijft fase 5.

Ongeldige events gaan naar ldv.rejected.v1 met vaste reden, hash en bronoffset,
zonder onbetrouwbare payload. Database-/netwerkuitval blijft herhaald worden met
begrensde backoff; geen functionele reject. Overige blijvende technische fouten
gaan na begrensde pogingen naar ldv.dead-letter.v1 met de gevalideerde envelop.
Offsets gaan pas vooruit na bevestigde opslag of acks=all op de foutstroom.
Een expliciet replaycommando levert dead letters opnieuw af met dezelfde envelop;
duplicaten zijn veilig. Geen automatische retentie of verwijdering toegevoegd.

## Volgorde en migratie

1. Plan en compatibele interne eventcontracten/voorbeelden vóór implementatie.
2. Schema, append-only bescherming, beperkte rollen en querymodule.
3. Consumer, classificatie, retries, foutstromen en gecontroleerde replay.
4. mTLS/ACL-configuratie, lokale launcher en synthetische end-to-enddemo.
5. Echte crash-/uitvalproeven, privacy- en contracttests, volledige verify.
6. Schone checkout, statusbewijs en commit.

Migratie 001 is transactioneel en herhaalbaar. Rollback stopt de consumer en
behoudt archief, volumes en offsets. Geen destructieve downmigratie. Productie-
backup/restore en bewaarbeleid zijn fase 8. Bestaande registergegevens blijven intact.

## Deliverables en verplichte gates

- [ ] Kafka-consumer met expliciet offsetbeheer.
- [ ] PostgreSQL append-only tabellen en migratie; unieke event_id.
- [ ] Functionele rejectstroom; technische retries en dead-letter-beleid.
- [ ] Query op event-, trace-, span- en processing-activity-ID.
- [ ] Integriteit/ontvangstmetadata zonder originele payload te wijzigen.
- [ ] Crash vóór DB-commit levert opnieuw.
- [ ] Crash na DB-commit vóór offsetcommit maakt geen duplicaat.
- [ ] Herhaald event_id is idempotent; conflicterende inhoud muteert niets.
- [ ] Tijdelijke DB-uitval geeft retry en geen functionele reject.
- [ ] Permanent ongeldig event komt met veilige reden in rejectstroom.
- [ ] Normale runtime/API kan records niet wijzigen, verwijderen of truncaten.
- [ ] POST → Kafka → opslag aantoonbaar; foutstroom-/replaytests groen.
- [ ] Contracten, privacy, mTLS/ACL, volledige verify en schone checkout groen.
- [ ] Demo, runbook, statusbewijs en commit; fase 5 niet gestart.

## Voortgang

2026-10-11: alle elf integratiegates geslaagd, inclusief beide echte crashes,
database-uitval, rejectpublicatie zonder ACL, technische DLQ/replay en append-only
rechten. De offsetwaarnemer gebruikte aanvankelijk een niet-bestaande clientmethode;
vervangen door listCommittedOffsets. Opslag en offsetcontrole zijn nu bewezen.
Volledige verify is geslaagd: 97 tests in 8 bestanden, foundation, 12 register-,
16 ingest- en 11 logboekgates. De consumer draait lokaal; demo en schone checkout volgen.

Aanvullend gebruikersverzoek binnen bestaand register: tien synthetische
platformvoorbeelden als concept toegevoegd via de editor-API. Een tweede run maakt
nul nieuwe activiteiten. Bestaande inhoud en publicaties zijn behouden. Grondslag
en retentie zijn expliciet nog vast te stellen demotekst. Geen contractwijziging.

2026-10-10: fase bepaald; register beschikbaar; uitvoering gestart binnen de
goedgekeurde architectuur en roadmap. Geen wijziging van LDV/ingestbody of retentie.
