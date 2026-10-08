# ExecPlan fase 0 — Fundament en besluiten

## Doel

Maak een minimale, reproduceerbare ontwikkelomgeving en laat technologie- en securitykeuzes goedkeuren voordat functionele services worden gebouwd.

## Scope

Alleen fase 0 uit `docs/implementation/roadmap.md`. Geen Register-, ingest-, Kafka-consumer-, query- of UI-functionaliteit implementeren.

## Deliverables

- [ ] ADR programmeertaal, framework, buildtool en monorepo-indeling.
- [ ] ADR lokale en productie-infrastructuur.
- [ ] ADR authenticatie en autorisatie.
- [ ] Projectscaffolding.
- [ ] Formatter, linter en testframework.
- [ ] Dependency locking.
- [ ] Lokale PostgreSQL-, Kafka- en optionele OpenSearchomgeving.
- [ ] Eén verificatiecommando.
- [ ] CI-workflow.
- [ ] Veilige configuratie zonder secrets.

## Werkvolgorde

1. Inventariseer bestaande contracten en architectuurdocumenten.
2. Werk maximaal twee concrete stackopties uit met gevolgen voor beheer, Kafka, JSON Schema, OpenAPI en frontend.
3. Leg de aanbevolen keuze vast in ADR's.
4. Stop voor menselijke goedkeuring.
5. Bouw na goedkeuring uitsluitend de scaffolding en lokale infrastructuur.
6. Voeg verificatie en CI toe.
7. Voer alle fase-0-tests uit.
8. Werk `docs/implementation/status.md` bij.

## Validatie

Documenteer exacte commando's zodra de buildtool is gekozen. Minimaal moeten een schone build, formattercontrole, linting, unit-test, contractsyntaxcontrole en infrastructuur-healthcheck reproduceerbaar slagen.

## Fasepoort

Fase 1 mag pas starten nadat alle checks groen zijn en de ADR's expliciet door een mens zijn geaccepteerd.
