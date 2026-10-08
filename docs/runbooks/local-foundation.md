# Lokale foundationdemo (fase 0)

Deze demo start PostgreSQL en Kafka en controleert beide met echte bewerkingen.
Er is nog geen Register API, ingestservice of adminconsole. Het HTML-rapport toont
de laatste uitgevoerde test; het is geen live monitor. Gebruik alleen synthetische data.

## Vereisten en installatie

- Node.js 24 LTS, referentiepatch in `.node-version`; ondersteund vanaf 24.16.0.
- npm 11.13.0 en Docker Engine met Compose en Linux-containers.
- Vrije loopbackpoorten 15432 en 19092 voor de blijvende demo.
- Toegang tot npm en Docker Hub voor de eerste installatie.

Op Windows: start Docker Desktop en controleer `docker version`. De serversectie
moet zichtbaar zijn. `docker context ls` alleen bewijst geen draaiende engine.

Vanuit de repositoryroot:

```text
npm ci
npm run demo
```

Op Windows PowerShell kun je `npm.cmd` gebruiken als scripts door execution policy
zijn geblokkeerd. De demo start de componenten, controleert `SELECT 1`, publiceert
en consumeert één synthetisch Kafka-bericht en schrijft `artifacts/demo.html` plus
`artifacts/demo.json`. Open het HTML-bestand in een browser. Beide componenten
blijven draaien totdat je ze stopt.

## Starten, controleren en stoppen

```text
npm run infra:up
npm run infra:check
npm run infra:down
```

Het ontwikkelproject heet `ldv-foundation-dev`. Stoppen verwijdert de containers
en het projectspecifieke netwerk, maar behoudt de named volumes en het secret.
Er is bewust geen automatische reset- of volumeverwijderingsopdracht voor de demo.
`docker ps --filter label=com.docker.compose.project=ldv-foundation-dev` toont
de draaiende componenten. De kortlevende `kafka-volume-init` mag succesvol beëindigd
zijn: deze stelt uitsluitend het eigenaarschap van de root van het Kafka-volume in.
Kafka zelf draait als niet-rootgebruiker.

## Configuratie

Niet-geheime defaults staan in `.env.example`. De npm-scripts lezen optioneel een
`.env` in de repositoryroot; bestaande procesvariabelen hebben voorrang.

| Variabele | Default | Betekenis |
| --- | --- | --- |
| LDV_ENV | local | Alleen local en test ondersteund |
| LDV_BIND_ADDRESS | 127.0.0.1 | Andere waarden worden geweigerd |
| POSTGRES_PORT | 15432 | Hostpoort voor PostgreSQL |
| KAFKA_PORT | 19092 | Hostpoort voor Kafka |

`NODE_ENV=production` en andere LDV-omgevingen worden geweigerd. Dit is geen
productiestarter. De goedgekeurde lokale uitzondering gebruikt PLAINTEXT binnen
het geïsoleerde Compose-netwerk en publiceert uitsluitend op loopback.

Bij eerste start wordt een willekeurig PostgreSQL-wachtwoord gegenereerd in
`.local/ldv-foundation-dev/postgres-password`. Dit bestand is genegeerd door Git en
wordt via een Compose secret aangeboden, niet als wachtwoord in YAML of CLI-argumenten.
Behoud dit bestand samen met het volume; verwijderen is geen wachtwoordrotatie.
PostgreSQL initialiseert wachtwoorden uitsluitend bij een leeg volume. Bescherm op
Windows de map met je accountrechten; de POSIX-modus is daar geen ACL-garantie.

## Volledige fasepoort

```text
npm ci
npm run verify
```

Dezelfde opdracht draait in GitHub Actions. De poort omvat formatter, linter,
TypeScript-build, unit-/toolingtests, contractsyntax en lokale referenties, schema-
en voorbeeldvalidatie, databasequery en Kafka-roundtrip. De semantische
LDV-validatiebibliotheek is pas fase 1.

Verificatie maakt een uniek `ldv-verify-<uuid>`-project zonder hostpoorten. Daardoor
kan de blijvende demo blijven draaien. Vervolgens wordt Kafka bewust gestopt:
de healthgate moet dit afkeuren. Na herstart moet Kafka opnieuw gezond worden.
In een finally-stap worden uitsluitend de eigen testcontainers en testvolumes
verwijderd. Een fout of ontbrekende engine resulteert in een niet-nul exitcode.

`artifacts/foundation.json` en `.html` bevatten de uitkomsten en duren per gate.
CI bewaart alleen deze geredigeerde rapporten, nooit `.local`, secrets of ruwe
containerlogs. `npm run verify:code` is handig zonder Docker, maar voltooit fase 0 niet.

## Problemen oplossen

- Geen Docker-server: start Docker Desktop in Linux-modus, controleer context en
  serverbereikbaarheid. De verificatie slaat infrastructuur nooit stil over.
- Poort bezet: stel een andere hostpoort in en start opnieuw. Bindadres blijft loopback.
- Kafka-volume niet schrijfbaar: controleer de exitstatus van `kafka-volume-init`.
  Geef Kafka geen rootrechten en gebruik geen globale volumeprune.
- Configuratie- of commandofout: het rapport vermeldt welke stap faalde. Subprocessoutput
  wordt niet automatisch gepubliceerd omdat die secrets kan bevatten. Bekijk lokaal
  alleen de eigen containerdiagnostiek; deel nooit secretbestanden of `docker inspect`
  met alle environmentwaarden.
- Afgebroken testproces: een uniek testproject kan achterblijven. Controleer de
  projectnaam en ownershiplabels voordat je uitsluitend dat testproject opruimt.

## Beperkingen

Deze fase bewijst lokale opstartbaarheid en basisconnectiviteit. Eén Kafka-broker
bewijst geen beschikbaarheid bij brokerverlies. Er zijn nog geen LDV-opslagtabellen,
HTTP-services, gebruikersauthenticatie, migraties of productie-retentie. Acceptatie
van de ADR's vervangt de securitytests van latere fasen niet.
