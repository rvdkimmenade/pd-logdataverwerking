# ADR-011: Stabiele ingest-identiteit bij retries

## Status

Proposed — 2026-10-09. Fase 2 is voltooid. Voor uitvoering is akkoord nodig omdat
deze keuze de publieke ingestinterface uitbreidt en een nieuwe duurzame technische
administratie binnen ingest toevoegt. Bestaande contracten zijn nog niet gewijzigd.

## Probleem

Het huidige OpenAPI-contract laat de server event_id genereren. De afspraken in
docs/architecture/reliability.md verlangen juist een stabiele identiteit wanneer
de bron na een timeout opnieuw aanbiedt. Een nieuw event_id bij iedere retry zou
de deduplicatie in fase 4 ondermijnen. Producer-idempotentie in Kafka lost een
nieuw HTTP-verzoek of een herstart van de ingestservice niet zelfstandig op.

## Voorgesteld besluit

1. Voeg een optionele HTTP-header `Idempotency-Key` (UUID) toe aan POST
   /v1/log-records. De logregelbody blijft ongewijzigd. Een bron die betrouwbare
   retries verlangt, genereert deze sleutel eenmaal per outboxevent en bewaart
   hem. De toekomstige publisher in fase 7 gebruikt deze header altijd.
2. Scope de sleutel op de geauthenticeerde bronapplicatie en verantwoordelijke.
   Ingest maakt een willekeurig event_id en ontvangsttijd bij de eerste aanvraag.
   Deze metadata en een SHA-256-hash van de canonieke JSON-payload worden vóór
   Kafka-publicatie duurzaam geregistreerd in PostgreSQL.
3. Bewaar uitsluitend technische metadata in deze ontvangstadministratie: bron,
   verantwoordelijke, sleutel, payloadhash, event_id, ontvangsttijd, status en
   acceptatietijd. Geen logregelpayload of subject-ID. Dit is geen LDV-archief.
4. Gelijke sleutel en gelijke inhoud: behoud hetzelfde event_id. Bij een al
   bevestigde publicatie retourneert ingest dezelfde 202-response. Bij een nog
   onzekere publicatie probeert ingest opnieuw met dezelfde envelop-identiteit.
5. Gelijke sleutel met andere inhoud: 409, zonder de gewijzigde payload te
   publiceren. Gelijktijdige aanvragen voor dezelfde sleutel worden geserialiseerd.
6. Geef 202 alleen nadat Kafka met acks=all heeft bevestigd en de acceptatiestatus
   duurzaam is opgeslagen. Bij database- of Kafka-uitval volgt 503. In het venster
   tussen Kafka-ack en opgeslagen acceptatie kan een retry opnieuw publiceren;
   dat blijft at-least-once met hetzelfde event_id voor deduplicatie in fase 4.
7. Zonder header blijft het bestaande verzoek geldig en krijgt ieder verzoek
   een nieuw server-ID, zoals het huidige contract. Deze compatibiliteitsroute
   geeft geen HTTP-retrydeduplicatie. Dit verschil wordt expliciet gedocumenteerd.

## Compatibiliteit en grenzen

De uitbreiding is opt-in: geen verplicht nieuw veld, geen wijziging van de
LDV-payload of technische envelop. De API blijft v1; de contractversie kan van
0.1.0 naar 0.2.0. Het conceptcontract staat in
[ingest-retry-contract.md](../proposals/ingest-retry-contract.md).

De ontvangstadministratie is apart van het register. Alleen de ingestservice
krijgt runtime-toegang; migratierechten blijven afzonderlijk. In de synthetische
POC vindt geen automatische opschoning van sleutels plaats. Productieretentie en
het maximaal ondersteunde retryvenster moeten in fase 8 expliciet worden gekozen.
Een eventuele latere opschoning mag niet stilzwijgend dezelfde sleutel opnieuw
als een ander event behandelen. Er worden nu geen echte gegevens geïntroduceerd.

## Beveiliging en fasering

Bronauthenticatie blijft mTLS volgens ADR-008, met server-side mapping van
geverifieerde certificaatidentiteit naar bron, verantwoordelijke en toegestane
verwerkingen. Onbekende bron/scope wordt geweigerd; clientheaders zijn geen bewijs
van identiteit. Het uitstel van OIDC betreft mensen in het beheerscherm, niet
authenticatie van bronapplicaties. De daadwerkelijke certificaat-/Kafka-configuratie
wordt vóór start getest; geen impliciete overgang naar een onveilige gedeelde demo.

Fase 3 levert ingest, ontvangstmetadata, Kafka-publicatie en hun testen. Append-only
LDV-opslag, consumerdeduplicatie en bedrijfsoutbox blijven in fasen 4 en 7.
De Kafka-clientkeuze is nog te toetsen op compatibiliteit met de gepinde Kafka 4.3.1,
acks=all, idempotentie, begrensde foutafhandeling en producerherstel.

## Alternatieven

- Iedere aanvraag een nieuw ID: eenvoudig maar ongeschikt voor stabiele retries.
- Verplicht client-event_id in de logregel: vermengt transport met LDV en breekt
  bestaande payloadcontracten.
- Alleen deterministisch ID uit sleutel: geen duurzame detectie van hergebruik
  met andere inhoud; dat kan later onterecht worden gededupliceerd.
- Alleen in-memory cache: verliest de garantie bij herstart.

## Verplichte bewijzen na akkoord

- Herhaling en serviceherstart behouden ID en response voor dezelfde sleutel.
- Verschillende bron/verantwoordelijke deelt geen ontvangststatus of identiteit.
- Andere payload onder dezelfde sleutel krijgt 409 en bereikt Kafka niet.
- Ongeldige/onbevoegde requests bereiken Kafka niet.
- Geen 202 bij ontbrekende duurzame acceptatie; 503 bij afhankelijkheidsuitval.
- Crashvenster na Kafka-ack wordt herhaald met hetzelfde event_id.
- Ontbrekende/ongeldige certificaatketen wordt afgewezen; juiste identiteit met
  verkeerde scope krijgt 403.
- Geen payloads, tokens of certificaatsleutels in fouten, metrics of technische logs.

## Goedkeuring

Nog niet ontvangen. Het bestaande publieke contract en de runtime zijn ongewijzigd.
