# Conceptuitbreiding ingestcontract — ter beoordeling

Status: voorstel bij ADR-011, geen actieve contractwijziging.

## Verzoek

```http
POST /v1/log-records
Content-Type: application/json
Idempotency-Key: 00000000-0000-4000-8000-000000000001
```

De UUID hierboven is uitsluitend een synthetisch voorbeeld. De body blijft de
bestaande LDV-logregel. Bron en verantwoordelijke volgen uit mTLS-configuratie.
`Idempotency-Key` is optioneel voor bestaande clients en noodzakelijk wanneer
de client dezelfde logregel met behoud van identiteit wil herhalen.

De sleutel wordt voor één inhoud per geauthenticeerde bron/verantwoordelijke
gebruikt. Object-sleutelvolgorde is niet inhoudelijk; de payloadhash gebruikt een
gedocumenteerde canonieke JSON-representatie. Arrayvolgorde blijft betekenisvol.

## Responsegedrag

| Situatie | HTTP | Gedrag |
| --- | --- | --- |
| Eerste geldige aanvraag | 202 | Alleen na Kafka-ack en duurzame acceptatiestatus |
| Herhaling van bevestigd verzoek | 202 | Zelfde event_id en accepted_at; geen nieuwe publicatie nodig |
| Herhaling van onzekere publicatie | 202 of 503 | Hergebruik event_id; nooit een vals succes |
| Zelfde scoped sleutel, andere inhoud | 409 | Vaste code IDEMPOTENCY_CONFLICT; niet publiceren |
| Ongeldige UUID-header of JSON | 400 | Vaste foutcode; geen payloadwaarden teruggeven |
| Ongeldige LDV-payload | 422 | Veilige validatiefouten uit fase 1 |
| Onbevoegde geverifieerde bron | 403 | Niet publiceren |
| Database of Kafka verhindert acceptatie | 503 | Bron bewaart event en herhaalt met dezelfde sleutel |
| Geen header | Bestaand gedrag | Per verzoek nieuw server-ID; geen HTTP-retrydeduplicatie |

Een ontbrekend of niet vertrouwd clientcertificaat wordt bij de TLS-handshake
geweigerd. De bestaande generieke 401-contractrespons blijft beschreven waar
authenticatiefalen op HTTP-niveau wordt afgehandeld.

De 202-body blijft `{ "event_id": "<uuid>", "accepted_at": "<date-time>" }`.
Er is geen claim dat Kafka nooit duplicaten bevat. Crashherhaling kan hetzelfde
event meermaals opleveren; deduplicatie op event_id hoort bij fase 4.
