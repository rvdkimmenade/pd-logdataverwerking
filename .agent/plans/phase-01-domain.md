# Fase 1 — LDV-domein en contractvalidatie

## Doel en uitgangssituatie

Een herbruikbare TypeScript-bibliotheek accepteert of weigert logregels en
transportenveloppen zonder netwerk, database of draaiende containers. Fase 0 is
voltooid. Bestaande JSON Schemas, voorbeelden en het LDV-profiel zijn leidend.
De normatieve LDV 1.0.0-bron is op 2026-10-08 gecontroleerd (secties 3.2 en 3.3).

## Scope en ontwerp

Alleen fase 1. Package @ldv/domain gebruikt de bestaande gepinde AJV-validator.
Publieke JSON Schemas blijven ongewijzigd. Schema-, semantische en demo-
beleidsvalidatie blijven afzonderlijk herkenbaar. Het persoonsdataprofiel vereist
de drie bestaande core-attributen; het implementeert niet alle mogelijke LDV-
profielen. Kandidaatvelden worden niet als vastgestelde extensie gepresenteerd.
Resultaten bevatten vaste foutcodes en veilige locaties, geen invoerwaarden.
Het demobeleid is expliciet opt-in en bewijst geen algemene PII-detectie.

Geen API, Register, Kafka-producer, database, migratie of productconsole.
Geen contractbreuk of nieuwe securitygrens. Terugrol is code terugzetten;
bestaande Kafka- en PostgreSQL-data worden niet geraakt.

## Uitvoering en bewijs

1. Beschrijf de regels in contracts/validation.md vóór de implementatie.
2. Voeg domeintypen, validator en namespace-indeling toe in packages/ldv-domain.
3. Voeg een manifest met positieve/negatieve fixtures en contracttests toe.
4. Koppel de domeinchecks aan contracts:check en voeg een offline demo toe.
5. Voer volledige verify en een schone checkout met npm ci / verify:code uit.
6. Werk README, runbook en status bij en commit de consistente fase.

## Deliverables

- [x] Domeintypen voor logregel, attributes, resource en transportenvelop.
- [x] JSON Schema-validatie.
- [x] Semantische validatie: tijdvolgorde, status, ID-formaten en persoonsdata-attributen.
- [x] Expliciete scheiding tussen LDV Core en kandidaatvelden dpl.pd.*.
- [x] Positieve en negatieve fixtures.
- [x] Contracttest die alle voorbeelden valideert.

## Verplichte tests en exitcriterium

- [x] Geldig demo-object geaccepteerd.
- [x] Ontbrekende core-attributen afgewezen.
- [x] Ongeldige trace- en span-ID afgewezen.
- [x] Ruwe identificatoren in demotests door beleidsvalidatie geweigerd.
- [x] Eindtijd vóór starttijd afgewezen.
- [x] Envelop alleen geldig met geldige payload.
- [x] Bibliotheek werkt zonder infrastructuur; alle contracttests groen.
- [ ] Volledige verify en schone checkout groen; demo en status bijgewerkt.
- [ ] Consistente wijziging gecommit.

## Bevindingen

De standaard laat protocollen vrij; de bestaande JSON-representatie blijft intact.
Het lokale schema vereist een URI voor identifier-type (de standaard laat ook een
string toe) en bevat kandidaatvelden: dit blijft nadrukkelijk een lokaal POC-profiel.
Open attributen in het schema worden niet stilzwijgend gesloten.
