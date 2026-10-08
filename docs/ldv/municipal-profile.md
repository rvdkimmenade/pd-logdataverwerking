# Kandidaatprofiel Platform Dienstverlening

## Status

Velden met prefix `dpl.pd.*` zijn POC-voorstellen. Ze zijn geen onderdeel van LDV Core 1.0.0 en mogen pas als interoperabele extensie worden gepresenteerd nadat de LDV-extensieprocedure is doorlopen.

## Voorgestelde velden

| Veld | Doel | Privacy-aandachtspunt |
|---|---|---|
| `dpl.pd.case_id` | Relatie met gemeentelijke zaak | Niet-herleidbare referentie, geen leesbaar zaaknummer |
| `dpl.pd.case_type` | URI of code van zaaktype | Geen vrije tekst |
| `dpl.pd.service_id` | Gemeentelijk product of dienst | Gebruik een catalogus-URI |
| `dpl.pd.channel` | Web, balie, telefoon, post, batch, API of intern | Leg geen medewerker vast |
| `dpl.pd.data_source` | Logische bronregistratie of dataset | Geen record-ID of inhoud |
| `dpl.pd.data_destination` | Logisch doelsysteem of ontvanger | Geen persoonsgegevens |

Systeemcontext zoals servicenaam, versie, deploymentomgeving en organisatie-ID past in `resource.attributes`.

## Bewust niet opnemen

- Naam of account van de behandelend ambtenaar: afzonderlijk auditlog.
- Doel, grondslag en bewaartermijn als vrije kopie: versioned Verwerkingsregister.
- Ruwe documentinhoud, BSN, e-mailadres of adres.
- Security-events en technische telemetrie zonder verantwoordingswaarde.
