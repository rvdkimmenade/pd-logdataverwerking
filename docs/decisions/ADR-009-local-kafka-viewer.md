# ADR-009: Lokale Kafka-viewer

## Status

Accepted — 2026-10-08. Roger van de Kimmenade heeft expliciet gevraagd om
Kafbat UI te downloaden en installeren. Dit besluit legt die lokale uitbreiding vast.

## Besluit

Voeg Kafbat UI v1.5.0 toe als optionele fase-0-ontwikkeltool. Pin het officiële
containerimage met digest. Gebruik een apart Compose-project `ldv-viewer` op het
bestaande lokale Kafka-netwerk. Publiceer alleen `127.0.0.1:18080`, configureer
de cluster `ldv-local` met bootstrapserver `kafka:9092` en zet read-only aan.
Schakel dynamische configuratie uit. Geen Docker-socket, lokale credentials of
datavolumes mounten. De installatie maakt geen nieuwe topics of berichten aan.

De lokale viewer is geen product-adminconsole uit fase 6. Er veranderen geen
publieke LDV-contracten, bewaartermijnen of productievoorzieningen. De gebruiker
kan synthetische lokale berichten inspecteren; er staan momenteel alleen interne
Kafka-topics omdat de foundationdemo haar tijdelijke testtopic opruimt.

## Grenzen en herstel

Alleen-lezen is hier een viewerinstelling, geen Kafka-ACL. Deze lokale viewer heeft
geen gebruikerslogin en is niet bedoeld voor een gedeelde omgeving of echte data.
Stop eerst de viewer en daarna de foundationstack. Verwijderen van de viewer
verwijdert geen Kafka-berichten of volumes. Opnieuw starten is reproduceerbaar
via npm run viewer:up; npm run viewer:check controleert HTTP en clusterstatus.

## Bron

[Kafbat configuratie](https://ui.docs.kafbat.io/configuration/misc-configuration-properties)
