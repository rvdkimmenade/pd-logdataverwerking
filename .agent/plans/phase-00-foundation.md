# ExecPlan fase 0 — Fundament en besluiten

## Doel

Maak een minimale, reproduceerbare ontwikkelomgeving en laat technologie- en securitykeuzes goedkeuren voordat scaffolding en functionele services worden gebouwd. De gebruiker vroeg op 2026-10-08 om de eerste fase te starten. De huidige fase is fase 0, niet fase 1.

## Huidige situatie en bronnen

Uitgangspunt: commit 2582037, uitsluitend documentatie en contractskeletten. Relevante bronnen zijn AGENTS.md, .agent/PLANS.md, docs/implementation/roadmap.md, docs/architecture/{overview,reliability,security}.md, docs/ldv/standard-profile.md, docs/testing/test-strategy.md en contracts/AGENTS.md. Er is nog geen verificatiecommando of CI-workflow.

## Scope

Alleen fase 0 uit `docs/implementation/roadmap.md`. Geen Register-, ingest-, Kafka-consumer-, query- of UI-functionaliteit implementeren.

## Deliverables

- [x] ADR programmeertaal, framework, buildtool en monorepo-indeling opgesteld; acceptatie open.
- [x] ADR lokale en productie-infrastructuur opgesteld; acceptatie open.
- [x] ADR authenticatie en autorisatie opgesteld; acceptatie open.
- [ ] Projectscaffolding.
- [ ] Formatter, linter en testframework.
- [ ] Dependency locking.
- [ ] Lokale PostgreSQL-, Kafka- en optionele OpenSearchomgeving.
- [ ] Eén verificatiecommando.
- [ ] CI-workflow.
- [ ] Veilige configuratie zonder secrets.

## Werkvolgorde

1. [x] Bestaande contracten, architectuur en aanwezige tools inventariseren.
2. [x] Twee stackopties uitwerken met gevolgen voor beheer, Kafka, JSON Schema, OpenAPI en frontend.
3. [x] Aanbevelingen vastleggen in ADR-006, ADR-007 en ADR-008, alle met status Proposed.
4. [ ] Stop voor menselijke goedkeuring. **Huidige positie.**
5. [ ] Na goedkeuring uitsluitend scaffolding, lockfile en lokale infrastructuur bouwen.
6. [ ] Formatter, linter, verificatie, runbook en CI toevoegen.
7. [ ] Alle fase-0-tests uitvoeren, ook vanuit een schone checkout.
8. [ ] Werkelijke testbewijzen en acceptatie in status.md opnemen en een consistente wijziging committen.

## Ontwerpkeuzes ter goedkeuring

- ADR-006 vergelijkt TypeScript/Node.js en C#/.NET; aanbeveling: TypeScript strict, Node.js 24 LTS, Fastify 5 en npm workspaces.
- ADR-007: PostgreSQL en Kafka via Compose. De single-node-demo is geen bewijs voor productie-HA. OpenSearch is pas in fase 5 nodig.
- ADR-008: mTLS voor workloads, OIDC voor mensen en rechten per verantwoordelijke, bron en actie. De lokale plaintext-uitzondering geldt uitsluitend voor synthetische infrastructuurtests.
- Een algemeen verzoek om te beginnen geldt niet als acceptatie van nog niet getoonde besluiten.

## Contracten en migraties

Geen wijzigingen in publieke contracten of databases tijdens deze beslisronde. De foundationchecker controleert syntax, schemastructuur en lokale referenties. De inhoudelijke domeinvalidatie blijft fase 1.

Twee bevindingen blijven zichtbaar: de OpenAPI-verwijzing onder examples.demo verwijst naar een kaal record en moet bij volledige OpenAPI-validatie worden beoordeeld als Example Object; de stabiele event_id aan de bron uit reliability.md moet vóór fase 3 worden afgestemd op het servergegenereerde ingest-event. Geen van deze punten wordt hier stilzwijgend opgelost door een contractwijziging.

## Validatie

Voorgesteld: npm ci gevolgd door npm run verify. Het laatste commando bevat ook infrastructuurchecks. PostgreSQL moet een echte query beantwoorden; Kafka moet een synthetisch bericht produceren en consumeren. Een ontbrekende engine of ongezonde service moet een foutstatus opleveren, geen stille skip. Losse documentcontroles tellen niet als foundationtest.

Verplichte tests uit de roadmap:

- [ ] Schone checkout kan bouwen.
- [ ] Unit-testvoorbeeld slaagt.
- [ ] Contractbestanden worden syntactisch gevalideerd door de repositoryverificatie.
- [ ] Lokale infrastructuur start en health checks worden groen.
- [ ] CI voert dezelfde checks uit.

Demonstratie: vanuit een schone checkout installeren, volledige verificatie uitvoeren, resultaten tonen en aantonen dat een ongezonde afhankelijkheid de poort niet passeert. README en runbook moeten overeenkomen met de werkelijke commando's.

## Betrouwbaarheid, security en terugrol

Geen runtime- of datamutaties in deze beslisronde. ADR-001 tot en met ADR-005 blijven leidend. Geen echte gegevens of productiecredentials nodig. De voorstellen kunnen zonder datamigratie worden herzien. Later worden alleen projectgebonden testcontainers opgeruimd; reguliere ontwikkelvolumes blijven behouden.

## Uitkomsten en bevindingen

- 2026-10-08: Node.js 24.16.0 en npm 11.13.0 aanwezig. Dit is inventarisatie, geen goedgekeurde securitypatchbaseline.
- 2026-10-08: Docker CLI 29.5.3 aanwezig, Docker Desktop Linux Engine niet bereikbaar, ook buiten de sandbox. Geen infrastructuurtest geslaagd.
- Drie reviewbare ADR's en bijgewerkte status opgesteld. Scaffolding wacht op stap 4. Geen latere fase gestart.

## Fasepoort

Fase 1 mag pas starten nadat alle checks groen zijn en de ADR's expliciet door een mens zijn geaccepteerd.

- [ ] Technologie- en security-ADR's door een mens geaccepteerd.
- [ ] Alle foundationchecks groen, inclusief schone checkout en CI.
- [ ] Demonstratie geslaagd en reproduceerbaar bewijs in status.md.
