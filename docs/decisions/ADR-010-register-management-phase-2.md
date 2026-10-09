# ADR-010: Registerbeheer in fase 2, OIDC in fase 6

## Status en goedkeuring

Accepted — 2026-10-08. Opdrachtgever: 'graag aanpassen en combineren', gevolgd
door 'graag nog even zonder oidc, voeg dat in een latere fase toe'. Dit besluit
vervangt alleen de hieronder beschreven fasering en lokale grens van ADR-008.

## Besluit

Fase 2 omvat Register API, PostgreSQL en een beheerscherm. Gebruik de geaccepteerde
TypeScript/Fastify-stack en een kleine HTML/CSS/JavaScript-interface. Er komt geen
nieuw frontendframework. Registerwizard, publicatie, versievergelijking en
historische raadpleging verhuizen uit fase 6. Bulkimport en autocomplete blijven
toekomstige uitbreidingen. OIDC blijft in fase 6.

Deze fase draait uitsluitend lokaal met synthetische gegevens. API en database-
hostpoorten binden aan 127.0.0.1. Opstarten weigert productie/gedeelde configuratie.
Voor de demo worden willekeurige toegangscodes per identiteit gegenereerd in een
genegeerd lokaal bestand. Codes worden niet gelogd of gecommit. Browsertoegang
gebruikt een kortlevende HttpOnly SameSite=Strict-sessie, uitsluitend op loopback.
Mutaties controleren Origin. Geen permissieve CORS. De lokale HTTP-uitzondering
wordt voor deze demo expliciet uitgebreid; TLS/OIDC voor gedeeld gebruik volgt
in fase 6. Er komt in fase 2 geen workload-integratie of productie-inzet.

Autorisatie vindt op de API plaats. Beheerders maken/bewerken concepten;
reviewers publiceren geen versies waaraan zij zelf hebben bijgedragen; lezers
muteren niet. Gegevens zijn per verantwoordelijke afgeschermd. Deze demo bewijst
rol- en scopehandhaving, geen enterprise-identiteitscontrole. mTLS- en echte
certificaatketentests blijven vereist vóór workload-integraties in fase 3.

## Versies en gevolgen

Publicatie bewaart de afgesproken geldigheidsperiode letterlijk en onveranderbaar.
Intervallen zijn halfopen [valid_from, valid_until); een lege einddatum betekent
onbegrensd. Een opvolger die daarmee overlapt wordt geweigerd. Kies vooraf een
einddatum wanneer opvolging voorzien is. Geen verborgen wijziging van een eerder
gepubliceerde einddatum; aanpassen van deze werkwijze vergt een apart besluit.

API-mutaties en audit-events worden atomair opgeslagen. Een databaseconstraint
weert overlappende publicaties, ook bij gelijktijdige verzoeken. Database-triggers
en beperkte runtime-rechten beschermen gepubliceerde versies en auditrecords.
Migraties worden geversioneerd; herstel gebeurt uit backup of code-terugrol zonder
automatische vernietiging van data.
