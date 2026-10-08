# POC-acceptatiematrix

| Kwaliteit | Bewijs | Fase |
|---|---|---|
| LDV-contract | Positieve en negatieve contracttests | 1 |
| Registerhistorie | Versie- en tijdstiptests | 2 |
| Duurzame acceptatie | Kafka-integratietest en 503-foutpad | 3 |
| Effectief eenmalige opslag | Crash- en duplicatietests | 4 |
| Append-only gedrag | Mutatie- en deletietests | 4 |
| Snelle raadpleging | Query- en performancetest | 5 |
| Herbouwbaarheid index | Volledige rebuildtest | 5 |
| Gebruiksvriendelijk beheer | End-to-end gebruikersscenario | 6 |
| Rollen en autorisatie | Negatieve autorisatietests | 6 en 8 |
| Outbox guaranteed delivery | Storingsmatrix voorbeeldapplicatie | 7 |
| Trace over componenten | W3C Trace Context scenario | 7 |
| Privacy | Review fixtures, logging en exports | Alle fasen |
| Herstelbaarheid | Backup/restore en DR-oefening | 8 |
| Operationele beheersbaarheid | Dashboards, alerts en runbooks | 8 |
| Belastbaarheid | Load- en duurtest | 8 |

Een criterium is pas behaald wanneer het bewijs reproduceerbaar is vastgelegd in `status.md`.
