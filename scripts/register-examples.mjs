import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = resolve(import.meta.dirname, '..');
const origin = 'http://127.0.0.1:18081';
const definitions = [
  [
    'Identiteit en toegangsbeheer',
    'Accounts en autorisaties voor toegang tot het platform beheren.',
    'Toegang beperken tot bevoegde gebruikers.',
    ['Synthetische platformgebruikers'],
    ['Account-ID', 'Rol en autorisaties', 'Accountstatus'],
    ['demo-portaal'],
    ['demo-identiteitsdienst'],
  ],
  [
    'API-verzoeken routeren',
    'Aanvragen via de API-gateway naar de juiste platformdienst doorsturen.',
    'Verzoeken bij de bedoelde dienst afleveren.',
    ['Synthetische aanvragers'],
    ['Aanvraagreferentie', 'Routeringsgegevens'],
    ['demo-api-gateway'],
    ['demo-procesdienst'],
  ],
  [
    'Berichtenuitwisseling',
    'Verwerkingsberichten via een berichtenplatform afleveren en bij storingen opnieuw aanbieden.',
    'Betrouwbare uitwisseling tussen platformdiensten ondersteunen.',
    ['Synthetische aanvragers'],
    ['Berichtreferentie', 'Aanvraaggegevens', 'Afleverstatus'],
    ['demo-procesdienst'],
    ['demo-berichtenplatform', 'demo-zaakdienst'],
  ],
  [
    'Documentopslag',
    'Bijlagen bij een aanvraag opslaan en aan een zaak koppelen.',
    'Documenten beschikbaar houden voor de behandeling.',
    ['Synthetische aanvragers'],
    ['Documentinhoud', 'Documentreferentie', 'Zaakreferentie'],
    ['demo-portaal'],
    ['demo-documentdienst'],
  ],
  [
    'Statusnotificaties',
    'Een statuswijziging omzetten naar een bericht voor de aanvrager.',
    'De aanvrager over de voortgang informeren.',
    ['Synthetische aanvragers'],
    ['Contactkanaal', 'Aanvraagreferentie', 'Status'],
    ['demo-zaakdienst'],
    ['demo-notificatiedienst'],
  ],
  [
    'Verantwoording dataverwerkingen',
    'LDV-records ontvangen en bewaren met verwijzing naar de verwerkingsactiviteit. Medewerkeridentiteit hoort niet in deze LDV-records.',
    'Dataverwerkingen achteraf kunnen reconstrueren.',
    ['Synthetische betrokkenen'],
    ['Pseudonieme betrokkene-ID', 'Activiteit-ID', 'Tijdstip', 'Trace-ID'],
    ['demo-bronapplicatie'],
    ['demo-ldv-ingest', 'demo-logarchief'],
  ],
  [
    'Beveiligingsmonitoring',
    'Toegangspogingen en beveiligingsmeldingen in een afzonderlijke beveiligingslog verwerken; gescheiden van LDV en telemetry.',
    'Ongeoorloofde toegang en incidenten onderzoeken.',
    ['Synthetische platformgebruikers'],
    ['Accountreferentie', 'Toegangspoging', 'Beveiligingsmelding'],
    ['demo-api-gateway', 'demo-identiteitsdienst'],
    ['demo-security-monitor'],
  ],
  [
    'Back-up en herstel',
    'Een herstelkopie van platformgegevens maken en een herstelactie uitvoeren.',
    'Beschikbaarheid van gegevens na een storing herstellen.',
    ['Synthetische aanvragers'],
    ['Kopie van aanvraaggegevens', 'Documentgegevens'],
    ['demo-zaakdienst', 'demo-documentdienst'],
    ['demo-back-updienst'],
  ],
  [
    'Ondersteuningsverzoeken',
    'Een ondersteuningsvraag over het platform registreren en afhandelen.',
    'Gebruikers helpen bij problemen met het platform.',
    ['Synthetische platformgebruikers'],
    ['Contactgegevens', 'Probleembeschrijving', 'Afhandelstatus'],
    ['demo-supportportaal'],
    ['demo-servicedesk'],
  ],
  [
    'Gegevensuitwisseling met ketenpartner',
    'Een afgebakende set aanvraaggegevens aan een aangesloten ketenpartner leveren.',
    'Een gezamenlijke behandeling van een aanvraag ondersteunen.',
    ['Synthetische aanvragers'],
    ['Aanvraagreferentie', 'Benodigde aanvraaggegevens'],
    ['demo-zaakdienst'],
    ['demo-ketenpartner'],
  ],
];
export const examples = definitions.map(
  ([name, description, purpose, subjects, data, sources, destinations]) => ({
    party: 'example-municipality',
    content: {
      name: `Demo platform: ${name}`,
      description: `Synthetisch voorbeeld; aanpassen aan de eigen inrichting. ${description}`,
      purpose,
      legal_basis:
        'Demovoorbeeld: de toepasselijke grondslag en onderbouwing moeten vóór publicatie worden vastgesteld.',
      retention:
        'Demovoorbeeld: termijn, startmoment en verwijderprocedure moeten vóór publicatie worden vastgesteld.',
      data_subject_categories: subjects,
      data_categories: data,
      processors: [
        'Synthetische platformleverancier; rol en afspraken te beoordelen',
      ],
      recipients: destinations.includes('demo-ketenpartner')
        ? ['Synthetische ketenpartner']
        : ['Bevoegde rollen binnen de demo-organisatie'],
      source_systems: sources,
      destination_systems: destinations,
    },
    valid_from: '2026-01-01T00:00:00Z',
    valid_until: '2027-01-01T00:00:00Z',
  }),
);

async function main() {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addSchema(
    JSON.parse(
      await readFile(
        resolve(root, 'contracts/schemas/register.schema.json'),
        'utf8',
      ),
    ),
  );
  const validate = ajv.getSchema(
    'https://schemas.example.invalid/register.schema.json#/$defs/create',
  );
  if (!examples.every((example) => validate(example)))
    throw new Error('Invalid examples');
  if (process.argv.includes('--check')) {
    console.log(`${examples.length} platform examples validated`);
    return;
  }
  const config = JSON.parse(
    await readFile(
      resolve(root, '.local/ldv-register-dev/config.json'),
      'utf8',
    ),
  );
  if (config.mode !== 'local-demo' || config.origin !== origin)
    throw new Error('Local demo required');
  const editor = config.accounts.find(
    (account) =>
      account.actor.role === 'editor' &&
      account.actor.party === 'example-municipality',
  );
  let cookie;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${origin}/api/${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(`Register request failed (${response.status})`);
    cookie ??= response.headers.get('set-cookie')?.split(';')[0];
    return response.json();
  }
  await api('session', 'POST', { code: editor.code });
  let created = 0;
  try {
    const existing = await api('activities');
    if (existing.length >= 200)
      throw new Error('Register listing limit reached');
    for (const example of examples) {
      if (existing.some((activity) => activity.name === example.content.name))
        continue;
      await api('activities', 'POST', example);
      created++;
    }
    const current = await api('activities');
    if (
      !examples.every((example) =>
        current.some((activity) => activity.name === example.content.name),
      )
    )
      throw new Error('Examples missing');
    console.log(
      `${created} platform drafts created; ${examples.length} examples present. Existing activities retained.`,
    );
  } finally {
    await api('session', 'DELETE');
  }
}
main().catch(() => {
  console.error(
    'Platform examples failed; check local register availability and configuration.',
  );
  process.exitCode = 1;
});
