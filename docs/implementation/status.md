# Implementatiestatus

Dit bestand is het controlepunt voor de gefaseerde implementatie. Werk het bij na iedere betekenisvolle stap en voor iedere faseovergang.

## Huidige fase

**Fase 0 — Fundament en besluiten**

Status: gestart op 2026-10-08. Besluitvoorstellen gereed voor menselijke beoordeling; scaffolding nog niet gestart. Fase 0 is niet voltooid.

## Faseoverzicht

| Fase | Status | Bewijs | Open punten |
|---|---|---|---|
| 0. Fundament en besluiten | Wacht op goedkeuring voorstellen | ADR-006/007/008 en ExecPlan | Acceptatie, scaffolding, Docker Engine en foundationchecks |
| 1. LDV-domein en contractvalidatie | Geblokkeerd door fase 0 | — | — |
| 2. Versioned Verwerkingsregister | Geblokkeerd door fase 1 | — | — |
| 3. Ingest API en Kafka | Geblokkeerd door fase 2 | — | — |
| 4. Consumer en logopslag | Geblokkeerd door fase 3 | — | — |
| 5. Zoekprojectie en Query API | Geblokkeerd door fase 4 | — | — |
| 6. Adminconsole | Geblokkeerd door fase 5 | — | — |
| 7. Applicatie-outbox | Geblokkeerd door fase 6 | — | — |
| 8. Hardening en acceptatie | Geblokkeerd door fase 7 | — | — |

## Bewijs per fase

### Fase 0: besluitvoorbereiding

Uitgangscommit: 2582037 (roadmap). De commit van deze beslisronde is na committen reproduceerbaar op te vragen met `git log -1 --format=%H -- docs/decisions/ADR-006-technology-and-repository.md`; zo ontstaat geen zelfverwijzing naar de hash van dit bestand.

Reviewbare resultaten:

- [ADR-006: technologie en repository-indeling](../decisions/ADR-006-technology-and-repository.md).
- [ADR-007: infrastructuur](../decisions/ADR-007-infrastructure.md).
- [ADR-008: authenticatie en autorisatie](../decisions/ADR-008-authentication-and-authorization.md).
- [ExecPlan fase 0](../../.agent/plans/phase-00-foundation.md).

Alle nieuwe ADR's zijn Proposed. Naam/rol en datum van menselijke goedkeuring: nog niet ontvangen. Het verzoek om te starten is niet geregistreerd als acceptatie van deze concrete besluiten.

Inventarisatie op 2026-10-08:

| Commando | Uitkomst |
|---|---|
| node --version | v24.16.0 |
| npm.cmd --version | 11.13.0 |
| docker version (buiten sandbox) | Client 29.5.3; Linux-enginepipe ontbreekt |
| docker context ls (buiten sandbox) | desktop-linux actief, engine nog niet bereikbaar |
| git log -1 --format='%h %s' bij aanvang | 2582037, roadmapcommit |

Het gecombineerde Docker-inventarisatiecommando eindigde met exitcode 0 doordat context ls slaagde. De afzonderlijke enginefout blijft een mislukte beschikbaarheidscontrole; dit is geen groene infrastructuurtest.

### Verplichte foundationgates

| Gate | Resultaat |
|---|---|
| Schone checkout/build | Niet uitgevoerd; scaffolding wacht op goedkeuring |
| Formatter/linter | Niet ingericht |
| Unit-testvoorbeeld | Niet ingericht |
| Repositorycontractvalidator | Niet ingericht; losse JSON-parsing is onvoldoende |
| Infrastructuur start en healthchecks | Niet uitgevoerd; Docker Engine ontbreekt |
| CI met dezelfde checks | Niet ingericht; geen CI-run of runlink |
| Demonstratie | Besluitdocumenten, geen draaiend platform |
| Menselijke acceptatie | Open voor ADR-006, ADR-007 en ADR-008 |

Er is nog geen repositoryverificatiecommando. Voorgesteld is npm run verify inclusief infrastructuur. Geen foundationgate is groen verklaard.

### Uitgevoerde documentcontroles

Op 2026-10-08: git diff --check geslaagd; 5 JSON-bestanden succesvol geparseerd; lokale Markdown-links gecontroleerd in 22 bestanden zonder ontbrekende doelen. De Git-meldingen over LF/CRLF zijn normalisatiewaarschuwingen, geen testfouten. Deze checks bewijzen geen schema-, OpenAPI- of runtimeconformiteit.

Reproduceerbaar vanuit de repositoryroot met PowerShell:

```powershell
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed' }
$jsonFiles = @(Get-ChildItem contracts -Recurse -Filter *.json)
foreach ($file in $jsonFiles) {
    Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json -ErrorAction Stop | Out-Null
}
Write-Output ('JSON syntax OK: ' + $jsonFiles.Count + ' files')
$markdownFiles = @(Get-ChildItem docs,.agent -Recurse -Filter *.md)
foreach ($file in $markdownFiles) {
    $body = Get-Content -Raw -LiteralPath $file.FullName
    foreach ($match in [regex]::Matches($body, '\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value
        if ($target -notmatch '^(https?://|#)') {
            $resolved = Join-Path $file.DirectoryName ($target.Split('#')[0])
            if (-not (Test-Path -LiteralPath $resolved)) { throw ('Broken link: ' + $resolved) }
        }
    }
}
Write-Output ('Local Markdown links OK: ' + $markdownFiles.Count + ' files')
```

## Besluiten en blokkades

1. Het bestaande ExecPlan schrijft goedkeuring vóór scaffolding voor (werkvolgorde stap 4); AGENTS.md eist menselijke acceptatie voor fase 0. Na acceptatie volgt eerst de foundationimplementatie, nog niet fase 1.
2. Docker Desktop Linux Engine draait niet. Deze moet beschikbaar zijn voor de verplichte infrastructuurproeven.
3. Bij OpenAPI-validatie moet de verwijzing naar een kaal record onder examples.demo worden beoordeeld. Vóór fase 3 moet de stabiele retry-identiteit uit reliability.md worden afgestemd op het ingestcontract. Dit zijn geregistreerde, nog onopgeloste bevindingen.
4. Hostingprovider, concrete identityprovider, retentieduur en RPO/RTO zijn niet gekozen; de POC is niet productierijp.
