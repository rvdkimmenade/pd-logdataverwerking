# ExecPlan fase 0 — Fundament en besluiten

## Doel en uitgangssituatie

Lever een reproduceerbare technische ontwikkelomgeving. Fase 0 is de enige actieve
fase; geen Register-, ingest-, consumer-, query-, domein- of consolefunctionaliteit.
Baseline: commit 99ee227 bevat de voorgestelde ADR's bovenop roadmapcommit 2582037.

Bronnen: AGENTS.md, .agent/PLANS.md, docs/implementation/roadmap.md,
docs/architecture/{overview,reliability,security}.md, docs/testing/test-strategy.md,
contracts/AGENTS.md en ADR-006/007/008.

## Goedkeuring en ontwerp

Roger van de Kimmenade (opdrachtgever) heeft op 2026-10-08 expliciet geschreven:
'ik geef goedkeuring voor de 3 voorstellen'. ADR-006/007/008 zijn Accepted.
TypeScript strict, Node.js 24 LTS en npm workspaces vormen de basis. Fastify blijft
een keuze voor toekomstige HTTP-services en wordt nog niet ongebruikt geïnstalleerd.
PostgreSQL 18 en Kafka 4 draaien via Compose; OpenSearch volgt pas in fase 5.
mTLS/OIDC volgen bij de services. De lokale PLAINTEXT-uitzondering geldt alleen
voor synthetische data, geïsoleerde netwerken en loopbackpoorten.

## Deliverables uit de roadmap

- [x] ADR voor taal, framework, buildtool en repository-indeling, geaccepteerd.
- [x] ADR lokale/productie-infrastructuur, geaccepteerd.
- [x] ADR authenticatie/autorisatie, geaccepteerd.
- [x] Projectscaffolding met formatter, linter en testframework.
- [x] Dependency locking met exacte dependencies en package-lock.json.
- [x] Lokale PostgreSQL/Kafka-omgeving; OpenSearch niet nodig in deze fase.
- [x] Eén volledige verificatieopdracht: npm run verify.
- [x] CI-workflow die npm ci en dezelfde verificatie uitvoert.
- [x] Environmentconfiguratie, loopbackdefaults en gegenereerde lokale secrets.

## Uitgevoerde stappen

1. Architectuur, roadmap, contracten en tools geïnventariseerd.
2. Goedkeuring vastgelegd en ADR-index bijgewerkt.
3. Minimale foundationworkspace met configuratievalidatie en tests gebouwd.
4. Syntax-/schema-/referentiecontrole voor bestaande contracten ingericht.
5. Compose met gepinde images/digests, secrets en healthchecks toegevoegd.
6. Afzonderlijke ontwikkel- en unieke verificatieprojecten gemaakt.
7. npm run demo uitgevoerd: query en Kafka-roundtrip geslaagd; HTML/JSON-bewijs.
8. npm run verify uitgevoerd: code, contracten, infrastructuur en negatieve
   stop/herstart-proef geslaagd. De ontwikkelomgeving bleef draaien.
9. README, runbook en implementatiestatus bijgewerkt.
10. Nog te bewijzen: verificatie op een schone checkout en daadwerkelijke CI-run.

## Contracten en migraties

De ongeldige OpenAPI Example Object-ref is vervangen door externalValue naar
hetzelfde ongewijzigde JSON-record. Geen gewijzigde velden, HTTP-responses of
securitygrenzen. De toolingtests bewijzen de verwijzing en afwijzing van een
ontbrekende lokale referentie. Schema-/fixturechecks gebruiken AJV 2020-12.
Semantische LDV-domeinvalidatie blijft fase 1. Er zijn geen database-migraties.

Vóór fase 3 blijft retry-identiteit een expliciet contractpunt: reliability.md
vraagt een stabiele event_id vanaf de bron, terwijl het huidige ingestcontract
servergeneratie beschrijft. Dit is niet met een premature interfacewijziging opgelost.

## Verificatie en demonstratie

- [x] Formatter, linting, TypeScript-build en 24 tests lokaal geslaagd.
- [x] Contractsyntax: 6 documenten, 2 schemas, 1 OpenAPI en 5 voorbeelden.
- [x] PostgreSQL/Kafka starten gezond en beantwoorden echte bewerkingen.
- [x] Negatieve gate wijst gestopte Kafka af; herstart wordt weer groen.
- [x] Demo via npm run demo geslaagd; artifacts/demo.html is de momentopname.
- [ ] Schone checkout kan bouwen en npm run verify slaagt.
- [ ] CI voert dezelfde checks uit en heeft een groene runlink.

Commando's: npm ci, npm run demo, npm run verify. Op Windows mag npm.cmd worden
gebruikt. Node-referentiepatch staat in .node-version; ondersteunde ondergrens
staat in package.json. De CI-actions zijn op geverifieerde commit-SHA's gepind.

## Betrouwbaarheid, security en terugrol

Geen businessrecords of persoonsgegevens. Het testbericht is uitsluitend een
synthetische foundationprobe, geen LDV-logrecord. De teststack publiceert geen
hostpoorten. De demo gebruikt 127.0.0.1:15432 en 127.0.0.1:19092. Productie-
omgevingen, publieke bindadressen en ongeldige poorten worden geweigerd.

Geheimen staan uitsluitend in genegeerde .local-mappen, gemount als Compose secret.
Alleen de unieke teststack en haar volumes worden automatisch opgeruimd. De demo
behoudt volumes en secret bij npm run infra:down. Geen bestaande stacks opruimen.
Code terugrollen vereist geen migratie. Dit is geen bewijs voor productie-HA.

## Bevindingen en herstel

- Docker Desktop is gestart; de Linux Engine is nu bereikbaar.
- Het Kafka-volume werd aanvankelijk als root aangemaakt. Een beperkte, kortlevende
  initcontainer zet alleen de volumeroot op UID/GID 1000; Kafka blijft niet-root.
- ESLint 9 bleek niet meer ondersteund. ESLint 10 is binnen dezelfde goedgekeurde
  toolingkeuze vastgezet; installatiescan rapporteerde nul kwetsbaarheden.
- OpenAPI-examplefout is gerepareerd zonder payloadwijziging.
- Fouten worden per gate zichtbaar in HTML/JSON; subprocessoutput met mogelijke
  secrets wordt niet automatisch gepubliceerd.

## Exitcriterium

- [x] Technologie- en security-ADR's menselijk geaccepteerd.
- [x] Lokale foundationchecks en gedocumenteerde demonstratie groen.
- [ ] Schone checkout en daadwerkelijke CI groen, met evidence in status.md.
- [ ] Consistente commit en definitieve fase-evidence vastgelegd.

Fase 1 wordt niet in deze uitvoering gestart.
