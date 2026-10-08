# ADR-007: Lokale infrastructuur en productie-uitgangspunten

## Status

Proposed — 2026-10-08. Menselijke goedkeuring ontbreekt. Er wordt met dit voorstel niets uitgerold of ingekocht.

## Context

ADR-001 tot en met ADR-005 leggen Kafka, transactionele outbox, idempotentie, gezaghebbende opslag en registerhistorie vast. Fase 0 moet een herhaalbare ontwikkelomgeving bieden. Een lokale single-node demo bewijst geen productie-high-availability.

## Voorgesteld besluit: lokaal

- Docker Compose met Linux-containers voor PostgreSQL 18 en Apache Kafka 4 in KRaft-modus.
- Eén PostgreSQL-instance, met afzonderlijke databases/rollen voor register en logboek zodra die fasen starten. Geen functionele tabellen of migraties in fase 0.
- Eén Kafka-broker/controller voor lokale ontwikkeling. Replicatiefactor 1 en min.insync.replicas 1 zijn uitsluitend een expliciete lokale beperking.
- Geen OpenSearch in fase 0: de eerste zoekprojectie komt in fase 5. De roadmap maakt deze afhankelijkheid in fase 0 optioneel.
- Alleen noodzakelijke hostpoorten op 127.0.0.1 publiceren. Voorgestelde defaults: PostgreSQL 15432 en Kafka 19092; via environment variables wijzigbaar.
- Een projectspecifiek netwerk en persistente named volumes. Geen bestaande Docker-projecten of volumes opruimen.
- Exacte imageversies en digests bij implementatie vastleggen; geen latest. Elke upgrade moet opnieuw door de foundationchecks.
- PostgreSQL gebruikt lokaal een willekeurig gegenereerd, niet-gecommit demo-secret. Kafka PLAINTEXT is alleen in de geïsoleerde lokale synthetische demo toegestaan, na acceptatie van ADR-008.

## Voorgesteld besluit: productie

Ontwerp voor OCI-containers op een beheerd containerplatform. De concrete hostingpartij en orchestrator worden niet in deze POC gekozen. Er worden geen productieaccounts of infrastructuurresources aangemaakt.

De bestaande productiebaseline blijft gelden: minimaal drie Kafka-brokers verdeeld over beschikbaarheidszones, replicatiefactor 3, min.insync.replicas 2, acks=all en idempotente producers. PostgreSQL krijgt beheerde failover, versleuteling en herstelbare back-ups; logboek en register behouden afzonderlijke rollen en verantwoordelijkheden. Kafka is transport, PostgreSQL is gezaghebbend en de latere zoekindex is herbouwbaar.

TLS, workload identity, secrets en netwerktoegang volgen ADR-008. Lokale PLAINTEXT-configuratie mag niet als productieconfiguratie worden aangeboden. Retentieduur, RPO/RTO, volumes en hosting worden vóór productie door een eigenaar vastgesteld; er worden nu geen waarden verzonnen of automatische vernietigingsregels ingesteld.

## Foundationchecks na goedkeuring

1. Controleer Docker Engine, Compose en benodigde poorten; geef bij ontbreken een fout met herstelactie.
2. Valideer de gerenderde Compose-configuratie zonder secretwaarden in CI-logs af te drukken.
3. Start een geïsoleerd verificatieproject met een begrensde wachttijd.
4. PostgreSQL: pg_isready én een echte SELECT 1.
5. Kafka: broker-metadata ophalen en een tijdelijk testtopic met één synthetisch bericht produceren/consumeren.
6. Toon expliciet dat een ontbrekende of ongezonde service de verificatie laat falen.
7. Stop alleen het testproject. De normale ontwikkelomgeving behoudt volumes; vernietigen daarvan is een aparte, expliciete beheeractie.

Groene containerstatus alleen is onvoldoende. Output rapporteert versies, afzonderlijke controles en fouten. CI voert dezelfde scripts uit en bewaart geredigeerde diagnostiek bij fouten. Een testrun mag geen bestaande LDV-omgeving hergebruiken als bewijs voor een schone start.

## Alternatieven

Native installaties op Windows maken Kafka- en CI-pariteit lastiger. Een volledig lokaal Kubernetes-cluster en een drie-brokercluster zijn zwaarder dan nodig voor deze foundationfase. High-availability- en brokeruitvalproeven volgen in de daarvoor aangewezen latere fasen.

## Inventarisatie en terugrol

Op 2026-10-08 is Docker CLI 29.5.3 gevonden. Ook buiten de sandbox ontbreekt de pipe voor Docker Desktop Linux Engine. De engine moet worden gestart vóór infrastructuurchecks kunnen slagen. Er zijn geen images gedownload, containers gestart of volumes gewijzigd.

De voorstellen zijn terug te draaien als documentwijziging. Na implementatie is stop/start met behoud van volumes de standaard. Schemaherstel wordt pas bij de databasefasen toegevoegd.

## Bronnen

- [PostgreSQL versiebeleid](https://www.postgresql.org/support/versioning/)
- [Officiële Apache Kafka-images](https://kafka.apache.org/community/downloads/)
- [Compose en service-healthchecks](https://docs.docker.com/compose/how-tos/startup-order/)

## Goedkeuring

Te accepteren: lokale single-node Compose-omgeving, optionele zoekindex pas in fase 5, productie-uitgangspunten zonder providerkeuze en de begrensde lokale security-uitzondering uit ADR-008.
