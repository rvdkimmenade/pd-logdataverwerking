# ADR-006: Programmeertaal, framework en repository-indeling

## Status

Proposed — 2026-10-08. Menselijke goedkeuring ontbreekt. Dit voorstel geeft nog geen toestemming om scaffolding of services te bouwen.

## Context

Fase 0 vraagt om een reproduceerbare basis voor afzonderlijke services, contractvalidatie en later een adminconsole. De repository bevat uitsluitend documentatie en contractskeletten. Er is geen vastgelegde voorkeur voor een taal of organisatiebrede ontwikkelstandaard.

## Afgewogen opties

| Aspect | A: TypeScript / Node.js | B: C# / .NET |
|---|---|---|
| Backend | Node.js 24 LTS, TypeScript strict, Fastify 5 | .NET 10 LTS, ASP.NET Core |
| Build en locking | npm workspaces, package-lock.json, npm ci | dotnet CLI, locked NuGet restore |
| Tests | Vitest, ESLint, Prettier | xUnit, analyzers, dotnet format |
| Contracten | AJV met JSON Schema 2020-12; expliciete OpenAPI-validatie | JSON Schema-validator met 2020-12-ondersteuning en OpenAPI-validatie |
| Kafka | Client apart toetsen op producer-idempotentie en handmatig offsetbeheer vóór fase 3 | Eveneens expliciete client- en configuratietoets vóór fase 3 |
| Frontend later | TypeScript sluit aan op een browserfrontend | Aanvullende frontendtoolchain of een .NET-frontendkeuze nodig |
| Belangrijkste afweging | Eén taal en buildomgeving; runtimevalidatie blijft noodzakelijk | Sterke optie als beheer en team al op .NET zijn ingericht |

## Voorgesteld besluit

Kies optie A: TypeScript strict op Node.js 24 LTS, Fastify 5 voor toekomstige HTTP-services en npm workspaces. Dit is een POC-keuze voor een compacte ontwikkelomgeving, geen onderbouwde uitspraak dat Node.js sneller is dan .NET. Kies optie B als de eigenaar een .NET-organisatiestandaard bevestigt.

Gebruik TypeScript voor build/typechecking, Vitest voor tests, ESLint voor codecontrole en Prettier voor formattering. Gebruik AJV expliciet in 2020-12-modus voor bestaande JSON Schemas; compile-time typen vervangen geen runtimevalidatie. Externe contracten blijven de bron van waarheid. Geen framework-default dat stilzwijgend hun dialect wijzigt.

Na goedkeuring worden exacte compatibele versies vastgelegd in package-lock.json en runtimeconfiguratie. npm ci is de installatiepoort. Containerimages worden op versie en digest gepind. Geen zwevende latest-tags. De lokaal gevonden Node.js 24.16.0 en npm 11.13.0 zijn inventarisatiegegevens, geen goedgekeurde productiepatchbaseline.

## Voorgenomen indeling

```text
apps/                  # services pas aanmaken in hun roadmapfase
packages/foundation/   # minimale configuratie en unit-testvoorbeeld in fase 0
packages/ldv-domain/   # pas fase 1
contracts/             # bestaande publieke contracten
infra/                 # lokale Compose-configuratie en gezondheidscontroles
scripts/               # platformonafhankelijke verificatie
docs/runbooks/         # starten, stoppen, controleren en herstel
.github/workflows/     # CI die dezelfde verificatie aanroept
```

De indeling reserveert grenzen, maar rechtvaardigt geen lege service-implementaties voor latere fasen. Een workspace mag niet rechtstreeks in de interne bronbestanden van een andere workspace importeren.

## Verificatieontwerp

Na npm ci wordt npm run verify het volledige fase-0-commando, inclusief formattercontrole, linting, build, unit-testvoorbeeld, contractsyntax en infrastructuur-healthchecks. Een aparte npm run verify:code mag sneller feedback geven maar kan nooit de fasepoort passeren. Make is niet nodig op Windows.

CI voert npm ci en npm run verify uit op een schone Linux-runner met Docker. Een schone lokale checkout moet hetzelfde bewijs leveren. Contractsyntaxcontrole omvat JSON/YAML parsing, schemastructuur en lokale referentieresolutie; de inhoudelijke LDV-validatiebibliotheek behoort tot fase 1. Een volledige OpenAPI-validator mag ongeldige Example Object-referenties niet negeren.

## Gevolgen en grenzen

- Geen publieke interfacewijzigingen in deze beslisronde.
- Fastify, Kafka-clients en domeinbibliotheken hoeven nog niet als ongebruikte dependencies te worden geïnstalleerd.
- Geen dienstverleningslogica, database-migraties of console in fase 0.
- Kafka-clientselectie moet de bestaande betrouwbaarheidseisen aantoonbaar ondersteunen; een incompatibele client is geen reden om die eisen af te zwakken.
- Een terugkeer naar optie B kan nu zonder datamigratie; na implementatie vereist een stackwijziging een nieuw besluit.

## Bronnen

- [Node.js releasebeleid](https://nodejs.org/en/about/previous-releases)
- [Fastify LTS-beleid](https://fastify.dev/docs/v5.10.x/Reference/LTS/)
- [.NET supportbeleid, alternatief](https://dotnet.microsoft.com/en-us/platform/support/policy)

## Goedkeuring

Te accepteren: optie A, tooling, repository-indeling en de volledige verificatiepoort. Naam/rol, datum en besluit worden pas na expliciete goedkeuring ingevuld in de implementatiestatus.
