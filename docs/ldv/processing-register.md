# Verwerkingsregister

## Doel

Het Register bevat relatief statische context over verwerkingsactiviteiten. Een logregel verwijst via `dpl.core.processing_activity_id` naar een activiteit. Er wordt geen registerrecord per inwoner gemaakt.

## Versies

Een verwerkingsactiviteit heeft een stabiele ID en één of meer versies. Iedere relevante wijziging maakt een nieuwe versie met `valid_from` en optioneel `valid_until`. Gepubliceerde versies zijn immutable.

Een historische query resolveert de versie die geldig was op het tijdstip van de logregel.

De fase-2-API gebruikt halfopen intervallen: de begindatum telt mee, de einddatum
niet. Een gepubliceerde einddatum wordt nooit achteraf gewijzigd. Laat je de
einddatum leeg, dan is de versie onbeperkt geldig en wordt een overlappende opvolger
geweigerd. Een concept kan worden aangepast zolang het niet gepubliceerd is;
revision voorkomt het overschrijven van gelijktijdige wijzigingen.

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

Fase 2 bevat een invoerwizard, concepten, publicatie door een andere rol, nieuwe
versies op basis van bestaande inhoud, validatie, versieverschillen en historische
raadpleging. Bulkimport, deeplinks en autocomplete zijn toekomstige uitbreidingen.
OIDC volgt in fase 6; de huidige interface gebruikt expliciete lokale demo-toegang
volgens ADR-010.

Applicaties vragen het Register niet voor iedere verwerking synchroon op. De stabiele activiteit-ID wordt doorgaans tijdens configuratie of deployment gekoppeld.
