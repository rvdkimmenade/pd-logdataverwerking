# Architectuuroverzicht

## Doel

Het platform ontkoppelt gemeentelijke applicaties van centrale LDV-opslag, zonder logregels te verliezen wanneer netwerk of centrale voorzieningen tijdelijk niet beschikbaar zijn. Het Register is zelfstandig beheerbaar en logregels zijn snel doorzoekbaar via een adminconsole.

## Componenten

| Component | Verantwoordelijkheid |
|---|---|
| Applicatie | Voert de dataverwerking uit en maakt trace-, span- en LDV-context |
| Transactionele outbox | Slaat businessmutatie en te publiceren event atomair op |
| LDV publisher | Leest de outbox en levert events herhaald aan tot ontvangst bevestigd is |
| Ingest API | Authenticeert bron, valideert LDV-logregel, maakt envelop en accepteert events |
| Ontvangstadministratie | Bewaart uitsluitend stabiele retry-identiteit en acceptatiestatus (ADR-011) |
| Kafka | Duurzaam transport, piekbuffer, fan-out en replay |
| Log consumer | Valideert inhoud, dedupliceert en schrijft duurzaam |
| Append-only logopslag | Gezaghebbende opslag van geaccepteerde logregels |
| Zoekindex | Snelle, herbouwbare projectie voor onderzoek |
| Register API | Beheer en historische raadpleging van verwerkingsactiviteiten |
| Query API | Autorisatie en samengestelde queries over log, index en register |
| Adminconsole | Registerbeheer, traceonderzoek, export en operationeel inzicht |

## Componentdiagram

```mermaid
flowchart TB
  subgraph Applicatie
    A[Businessapplicatie] --> O[(Outbox)]
    O --> P[LDV publisher]
  end
  subgraph Inname
    P --> G[Ingest API]
    G --> K[(Kafka)]
    G --> M[(Ontvangstmetadata)]
  end
  subgraph Logboek
    K --> C[Log consumer]
    C --> D[(Append-only opslag)]
    D --> P2[Projector]
    P2 --> I[(Zoekindex)]
  end
  subgraph Register
    R[Register API] --> RDB[(Versioned register)]
  end
  subgraph Beheer
    UI[Adminconsole browser] --> B[Consolebackend]
    UI --> OIDC[OIDC-provider]
    B --> Q[Query API]
    Q --> I
    Q --> D
    Q --> R
    B --> R
  end
```

## Schrijf- en leespaden

De lokale implementatie realiseert ingest → Kafka → logconsumer → PostgreSQL-archief,
een herbouwbare OpenSearch-projectie en de Query API. De console gebruikt OIDC voor
menselijke toegang en mTLS met begrensde partij- en applicatiescope voor queries.
Registerbeheer gebruikt dezelfde console-sessie. De lokale outbox volgt in fase 7.

Het schrijfpad is volledig asynchroon vanaf de lokale outbox. De applicatie is niet afhankelijk van Kafka, de zoekindex of het Register tijdens een gebruikersrequest.

De append-only opslag is de bron van waarheid. De zoekindex bevat een denormaliseerde projectie en mag volledig worden verwijderd en opnieuw worden opgebouwd. De Query API gebruikt de index voor zoeken en haalt zo nodig het originele record en de historisch geldige registerversie op.

## Scheiding van logstromen

LDV-logging, security-/auditlogging en telemetrie mogen infrastructuur delen, maar hebben eigen topics, schema's, autorisaties, opslag en retentie. Correlatie vindt plaats via `trace_id`, niet door gebruikersidentiteiten in LDV-logregels op te nemen.
