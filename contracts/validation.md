# Uitvoerbare validatie van het POC-profiel

Fase 1 verandert de bestaande JSON Schemas niet. De functies validateLogRecord
en validateEnvelope in @ldv/domain accepteren onbekende JSON-invoer en geven een
discriminerend resultaat: valid met value, of ongeldig met issues. Invoer wordt
niet gecorrigeerd, aangevuld of gemuteerd.

## Lagen

1. Schema: de bestaande 2020-12-schema's bepalen velden, verplichte core-
   attributen, URI/UUID/date-time-formaten, hexlengtes, status en kandidaatvelden.
2. Semantiek: end_time >= start_time; tijden zijn exact representeerbare veilige
   gehele JS-getallen; trace_id, span_id en aanwezige parent_span_id zijn niet
   volledig nul. Nulduur is geldig. Hoofdletters in hex blijven toegestaan.
3. Optioneel beleid `policy: 'synthetic-demo'`: subject-ID moet voldoen aan
   `example-(subject|employee|organisation)-not-real-[0-9]{3}` en een aanwezige
   case-ID aan `example-case-not-real-[0-9]{3}`. Hierdoor worden ruwe BSN-, KvK-
   en personeelsnummers in de aangewezen tests geweigerd. Dit beleid is uitsluitend
   voor synthetische demo's: geen pseudonimiseerder of algemene PII-detector.

Een envelop doorloopt dezelfde payloadvalidatie inclusief het gekozen beleid.
De gewone validator doet geen registerlookup, autorisatie of controle van
cryptografische pseudonimisering. Een technisch geldig record is geen bewijs van
privacycompliance. Producers blijven verantwoordelijk voor gegevensminimalisatie.

## Namespaces en fouten

LdvCoreAttributes en PdCandidateAttributes zijn aparte typen. splitAttributes
verdeelt bekende core-velden, bekende kandidaatvelden en overige velden zonder
de invoer te wijzigen. Onbekende attributen blijven schema-technisch toegestaan;
dat maakt hun namespace niet tot een vastgestelde LDV-extensie.

Issues bevatten alleen laag, vaste code en een locatie uit bekende contractvelden.
Onbekende sleutels en aangeleverde waarden worden nooit in fouten opgenomen.
Er is geen logging of globale metricsstaat; services kunnen later issues tellen.

## Bronnen en grenzen

Gecontroleerd op 2026-10-08: [LDV 1.0.0, secties 3.2–3.3](https://gitdocumentatie.logius.nl/publicatie/logboek/dataverwerkingen/1.0.0/).
Het persoonsdataprofiel en kandidaatvelden zijn beschreven in docs/ldv/.
De fixtures in validation-cases.json bevatten uitsluitend verzonnen testwaarden.
