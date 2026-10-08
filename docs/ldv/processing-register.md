# Verwerkingsregister

## Doel

Het Register bevat relatief statische context over verwerkingsactiviteiten. Een logregel verwijst via `dpl.core.processing_activity_id` naar een activiteit. Er wordt geen registerrecord per inwoner gemaakt.

## Versies

Een verwerkingsactiviteit heeft een stabiele ID en één of meer versies. Iedere relevante wijziging maakt een nieuwe versie met `valid_from` en optioneel `valid_until`. Gepubliceerde versies zijn immutable.

Een historische query resolveert de versie die geldig was op het tijdstip van de logregel.

## Gegevens

Een registerversie bevat ten minste:

- stabiele activiteit-ID en versienummer;
- naam en omschrijving;
- doel;
- verantwoordelijke en eventuele verwerkers;
- categorieën betrokkenen en gegevens;
- ontvangers;
- grondslag;
- bewaartermijnen;
- bron- en doelsystemen;
- geldigheidsperiode;
- workflowstatus.

## Gebruiksvriendelijkheid

De adminconsole ondersteunt een invoerwizard, hergebruik van bestaande activiteiten, concept- en goedkeuringsstatus, validatie, versieverschillen, bulkimport, deeplinks en autocomplete voor activiteit-ID's.

Applicaties vragen het Register niet voor iedere verwerking synchroon op. De stabiele activiteit-ID wordt doorgaans tijdens configuratie of deployment gekoppeld.
