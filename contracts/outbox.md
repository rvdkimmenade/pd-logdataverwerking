# Voorbeeldapplicatie en LDV-publisher v1

De lokale synthetische voorbeeldapplicatie accepteert `example-case.schema.json`
via de CLI/adapter. Zij valideert input en LDV-records vóór de businesstransactie.
Businessrecord en alle outboxevents worden samen gecommit of samen teruggedraaid.
Het aantal events is één voor één betrokkene; bij meerdere betrokkenen één parent
plus één child per betrokkene. Parent verwijst naar de eerste synthetische
betrokkene, children ieder naar de eigen betrokkene. Geen medewerkeridentiteit.

Een geldige W3C `traceparent` versie 00 wordt overgenomen: trace-ID blijft,
parent-span-ID wordt parent van de nieuwe applicatiespan; nieuwe spans zijn
niet-nul en uniek. Zonder header ontstaat een nieuwe trace. Ongeldige header
wordt geweigerd, niet stil vervangen. Traceflags blijven behouden. De publisher
verstuurt `traceparent` met de opgeslagen eventspan; tracestate is geen input
van deze POC-adapter. LDV v1 blijft ongewijzigd.

Ieder event bewaart onveranderlijke payload, traceparent en UUID-sleutel. Elke
aanbieding gebruikt dezelfde `Idempotency-Key`. Alleen een valide HTTP 202 met
event_id en accepted_at geldt als acceptatie volgens ingest v1/ADR-011; bron-
status betekent ingestacceptatie, geen bewijs van latere archief/projectie.

De queue heeft pending, retry, blocked en delivered. SQL-leases met uniek token
worden atomair geclaimd; alleen de huidige eigenaar mag de status bevestigen.
Een crash laat de lease verlopen; herstart biedt dezelfde inhoud/sleutel opnieuw.
Timeout, ongeldige 202, netwerkfout, 408, 429 en 5xx retryen met begrensde
exponentiële backoff en jitter. Andere HTTP-responses blokkeren het event; na
oorzaakherstel kan een operator expliciet requeue uitvoeren zonder inhoud of
sleutel te veranderen. Events worden niet automatisch gewist.

Demo blijft loopback, HTTPS met geverifieerde CA/clientcertificaat en uitsluitend
synthetische input. Fouten/metrics bevatten alleen vaste codes en tellers, geen
payloads, subjecten, certificaten of credentials. Brondatabase en ingest/archief
hebben gescheiden toegangsrechten. Verlies van brondisk/backups, productie-HA,
retentie en garantie bij verlopen ingestdeduplicatie vallen buiten deze fase.
