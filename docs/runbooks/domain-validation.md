# Domeinvalidatie lokaal gebruiken

Fase 1 levert @ldv/domain als private workspace binnen deze repository.
Node.js en npm volstaan; Kafka, PostgreSQL en Docker zijn niet nodig voor deze demo.

```text
npm ci
npm run demo:domain
npm run verify:code
```

De demo valideert alle bestaande voorbeelden en de positieve/negatieve gevallen
uit contracts/examples/validation-cases.json. Hij telt geaccepteerde gevallen en
verwachte afwijzingen. Een afwijkende uitkomst geeft exitcode 1; invoerwaarden
worden niet gelogd. `npm run verify` blijft de volledige repositorypoort inclusief
de geïsoleerde fase-0-infrastructuurproeven.

Na de build kunnen andere workspaces de publieke exports gebruiken:

```typescript
import { validateLogRecord, validateEnvelope, splitAttributes } from '@ldv/domain';

const result = validateLogRecord(input, { policy: 'synthetic-demo' });
if (result.valid) {
  const { core, candidates, other } = splitAttributes(result.value.attributes);
  // Gebruik de gevalideerde waarde; kandidaatvelden zijn geen vastgestelde extensie.
} else {
  // result.issues bevat alleen veilige paden, lagen en vaste foutcodes.
}
const eventResult = validateEnvelope(event, { policy: 'synthetic-demo' });
```

Laat de optie weg voor schema- en semantische validatie zonder het synthetische
demobeleid. Het beleid accepteert alleen afgesproken voorbeeldmarkeringen voor
subject- en zaak-ID. Het herkent geen willekeurige persoonsgegevens in vrije tekst.
De library muteert invoer niet en heeft geen logging, netwerkclient of database.
JSON Schemas worden bij import lokaal geladen uit contracts/schemas; verplaats
het gebouwde package daarom niet los van deze private repository.

Regels en beperkingen: [validatiecontract](../../contracts/validation.md).
Bij afwijzing corrigeert de producer zijn invoer. Fouten worden niet stil hersteld.
Geen migratie nodig; terugrol van code heeft geen effect op bestaande data.
