# LDV-logregel en POST-interface

`POST /v1/log-records` ontvangt rechtstreeks een LDV-logregel. `start_time` en `end_time` zijn milliseconden sinds Unix epoch. `trace_id` bevat 16 bytes en `span_id` en `parent_span_id` ieder 8 bytes, in JSON weergegeven als hexadecimale strings. `parent_span_id` is optioneel.

Bij persoonsdata zijn `dpl.core.processing_activity_id`, `dpl.core.data_subject_id` en `dpl.core.data_subject_id_type` vereist. De activity-ID is een URI naar het Register.

## Data-subject-ID

Gebruik een stabiel, doelgebonden versleuteld of gepseudonimiseerd subject-ID. Log geen leesbaar BSN, personeelsnummer of KvK-nummer. Alle waarden in `contracts/examples/` zijn onmiskenbaar synthetisch.

| Context | Voorbeeldtype |
|---|---|
| Inwoner vanuit BSN | URI voor BSN-pseudoniem |
| Medewerker als betrokkene | URI voor personeelsnummer-pseudoniem |
| Onderneming | URI voor KvK-pseudoniem |

Gebruik per verantwoordelijke en doelcontext gescheiden pseudonimisering, versieer de methode en beheer sleutels buiten applicaties.

## Meerdere betrokkenen

Eén logregel verwijst naar nul of één betrokkene. Bij meerdere betrokkenen maakt de applicatie per betrokkene een child-actie met dezelfde `trace_id`, een nieuwe `span_id`, de oorspronkelijke span als `parent_span_id` en precies één subject-ID.

## Technische envelop

Na duurzame acceptatie maakt het platform een `event_id` en interne transportenvelop voor Kafka. Deze envelop behoort niet tot de publieke LDV-requestbody.
