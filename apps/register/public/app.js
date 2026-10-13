const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const roleNames = {
  editor: 'Registerbeheerder',
  reviewer: 'Privacy reviewer',
  reader: 'Alleen lezen',
};
const labels = {
  name: 'Naam',
  description: 'Omschrijving',
  purpose: 'Doel',
  legal_basis: 'Grondslag',
  retention: 'Bewaartermijn',
  data_subject_categories: 'Categorieën betrokkenen',
  data_categories: 'Categorieën gegevens',
  processors: 'Verwerkers',
  recipients: 'Ontvangers',
  source_systems: 'Bronsystemen',
  destination_systems: 'Doelsystemen',
  valid_from: 'Geldig vanaf',
  valid_until: 'Geldig tot',
};
const arrayKeys = [
  'data_subject_categories',
  'data_categories',
  'processors',
  'recipients',
  'source_systems',
  'destination_systems',
];
const errors = {
  AUTH_REQUIRED: 'Log in met een geldige demo-toegangscode.',
  FORBIDDEN: 'Je rol mag deze actie niet uitvoeren.',
  SECOND_PERSON_REQUIRED: 'Een andere reviewer moet deze versie publiceren.',
  STALE_REVISION:
    'Dit concept is intussen gewijzigd. Open de activiteit opnieuw voordat je verdergaat.',
  IMMUTABLE_PUBLICATION: 'Een gepubliceerde versie kan niet worden gewijzigd.',
  OVERLAPPING_INTERVAL:
    'De periode overlapt met een gepubliceerde versie. Pas de periode van het concept aan.',
  INVALID_INTERVAL: 'De einddatum moet na de begindatum liggen.',
  INVALID_REQUEST: 'Controleer de ingevulde velden en datums.',
  NO_VALID_VERSION: 'Op dit tijdstip was geen gepubliceerde versie geldig.',
  NOT_FOUND: 'Deze activiteit of versie is niet beschikbaar.',
  TRY_LATER: 'Te veel inlogpogingen. Probeer het over een minuut opnieuw.',
  UNAVAILABLE:
    'Het register is tijdelijk niet beschikbaar. Probeer het later opnieuw.',
};
let me,
  items = [],
  selected,
  detail;
function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = error ? 'error' : '';
  $('message').setAttribute('role', error ? 'alert' : 'status');
}
function hasRole(role) {
  return (me.roles ?? [me.role]).includes(role);
}
async function api(path, method = 'GET', data) {
  const r = await fetch(path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(
      errors[value.code] ?? 'De actie kon niet worden uitgevoerd.',
    );
  return value;
}
function run(action) {
  return async (event) => {
    event?.preventDefault();
    message('');
    const button =
      event?.submitter ??
      (event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : null);
    if (button) button.disabled = true;
    try {
      await action(event);
    } catch (e) {
      message(e.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  };
}
const format = (v) =>
  v ? new Date(v).toLocaleString('nl-NL') : 'Geen einddatum';
const local = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const show = (v) => (Array.isArray(v) ? v.join('\n') : (v ?? '—'));
async function load() {
  items = await api('/api/activities');
  list();
}
function list() {
  const q = $('filter').value.trim().toLocaleLowerCase('nl');
  const field = $('search-field').value;
  const status = $('search-status').value;
  const versions = $('search-versions').value;
  const visible = items.filter((i) => {
    const text =
      field === 'name'
        ? i.name
        : field === 'id'
          ? i.processing_activity_id
          : `${i.name} ${i.processing_activity_id}`;
    const published = i.version_count - i.draft_count;
    return (
      text.toLocaleLowerCase('nl').includes(q) &&
      (status === 'all' ||
        (status === 'draft' && i.draft_count > 0) ||
        (status === 'published' && published > 0) ||
        (status === 'draft-only' && published === 0)) &&
      (versions === 'all' ||
        (versions === 'single' && i.version_count === 1) ||
        (versions === 'multiple' && i.version_count > 1))
    );
  });
  const sort = $('search-sort').value;
  visible.sort((a, b) => {
    const nameOrder =
      a.name.localeCompare(b.name, 'nl') || a.id.localeCompare(b.id);
    return sort === 'versions'
      ? b.version_count - a.version_count || nameOrder
      : sort === 'name-desc'
        ? -nameOrder
        : nameOrder;
  });
  $('count').textContent =
    `${visible.length} van ${items.length} activiteiten · ${me.party}`;
  $('selection-note').hidden =
    !selected || visible.some((i) => i.id === selected);
  $('activities').innerHTML =
    visible
      .map(
        (i) =>
          `<button data-id="${esc(i.id)}" aria-current="${i.id === selected}">${esc(i.name)}<small>${i.version_count} versie(s) · ${i.draft_count} concept(en)</small></button>`,
      )
      .join('') ||
    '<p class="muted">Geen activiteiten gevonden. Pas de filters aan of kies Filters wissen.</p>';
  for (const b of $('activities').querySelectorAll('button'))
    b.onclick = run(() => open(b.dataset.id));
}
async function open(id) {
  selected = id;
  detail = await api(`/api/activities/${id}`);
  list();
  render();
}
function render() {
  const latest = detail.versions[0];
  $('detail').innerHTML =
    `<p class="eyebrow">VERWERKINGSACTIVITEIT</p><h2>${esc(latest.content.name)}</h2><p class="code muted">${esc(detail.processing_activity_id)}</p><p class="muted">${esc(detail.party)}</p><div class="toolbar"><h3>Versies</h3>${hasRole('editor') ? '<button id="next" class="secondary">Nieuwe versie</button>' : ''}</div>${detail.versions
      .map(
        (v) =>
          `<article class="version"><div class="toolbar"><strong>Versie ${v.version}</strong><span class="badge ${v.status === 'draft' ? 'draft' : ''}">${v.status === 'draft' ? 'Concept' : 'Gepubliceerd'}</span></div><p class="muted">${format(v.valid_from)} — ${format(v.valid_until)}</p><dl>${Object.keys(
            labels,
          )
            .filter((k) => !k.startsWith('valid_'))
            .map(
              (k) => `<dt>${labels[k]}</dt><dd>${esc(show(v.content[k]))}</dd>`,
            )
            .join(
              '',
            )}</dl><div class="actions">${v.status === 'draft' && hasRole('editor') ? `<button data-edit="${v.version}" class="secondary">Concept bewerken</button>` : ''}${v.status === 'draft' && hasRole('reviewer') ? `<button data-publish="${v.version}">Publiceren</button>` : ''}</div></article>`,
      )
      .join(
        '',
      )}<section class="history"><h3>Historisch raadplegen</h3><form id="history"><label for="at">Tijdstip</label><input id="at" type="datetime-local" required><button>Zoek geldige versie</button></form><p id="history-result" role="status"></p></section><section class="history"><h3>Versies vergelijken</h3><div class="grid"><div><label for="compare-a">Eerste versie</label><select id="compare-a">${options()}</select></div><div><label for="compare-b">Tweede versie</label><select id="compare-b">${options()}</select></div></div><div id="difference"></div></section>`;
  if ($('next')) $('next').onclick = () => wizard('next', latest);
  for (const b of $('detail').querySelectorAll('[data-edit]'))
    b.onclick = () =>
      wizard(
        'edit',
        detail.versions.find((v) => v.version === Number(b.dataset.edit)),
      );
  for (const b of $('detail').querySelectorAll('[data-publish]'))
    b.onclick = run(async () => {
      const v = detail.versions.find(
        (v) => v.version === Number(b.dataset.publish),
      );
      if (
        !window.confirm(
          `Versie ${v.version} publiceren? De inhoud en geldigheidsperiode worden daarna onveranderbaar.`,
        )
      )
        return;
      await api(
        `/api/activities/${selected}/versions/${v.version}/publish`,
        'POST',
        { revision: v.revision },
      );
      await open(selected);
      await load();
      message('Versie gepubliceerd. De inhoud en periode staan vast.');
    });
  $('history').onsubmit = run(async () => {
    $('history-result').textContent = '';
    const v = await api(
      `/api/activities/${selected}/resolve?at=${encodeURIComponent(new Date($('at').value).toISOString())}`,
    );
    $('history-result').textContent =
      `Versie ${v.version}: ${v.content.name} · ${v.content.purpose}`;
  });
  $('compare-a').onchange = compare;
  $('compare-b').onchange = compare;
  if (detail.versions.length > 1) $('compare-b').selectedIndex = 1;
  compare();
}
function options() {
  return detail.versions
    .map(
      (v) =>
        `<option value="${v.version}">Versie ${v.version} · ${v.status === 'draft' ? 'concept' : 'gepubliceerd'}</option>`,
    )
    .join('');
}
function compare() {
  const a = detail.versions.find(
    (v) => v.version === Number($('compare-a').value),
  );
  const b = detail.versions.find(
    (v) => v.version === Number($('compare-b').value),
  );
  const rows = Object.keys(labels)
    .map((k) => ({
      k,
      a: k.startsWith('valid_') ? a[k] : a.content[k],
      b: k.startsWith('valid_') ? b[k] : b.content[k],
    }))
    .filter((r) => JSON.stringify(r.a) !== JSON.stringify(r.b));
  $('difference').innerHTML = rows.length
    ? `<table><thead><tr><th>Veld</th><th>Eerste versie</th><th>Tweede versie</th></tr></thead><tbody>${rows.map((r) => `<tr><th>${labels[r.k]}</th><td>${esc(show(r.a))}</td><td>${esc(show(r.b))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Geen inhoudelijke verschillen.</p>';
}
function wizard(mode, source) {
  message('');
  const content = source?.content ?? {};
  const year = new Date().getFullYear();
  const from =
    mode === 'next'
      ? source.valid_until
      : (source?.valid_from ?? `${year}-01-01T00:00:00Z`);
  const until =
    mode === 'next'
      ? null
      : (source?.valid_until ?? `${year + 1}-01-01T00:00:00Z`);
  function field(k) {
    const array = arrayKeys.includes(k);
    const required = ![
      'processors',
      'recipients',
      'destination_systems',
    ].includes(k);
    return `<div><label for="${k}">${labels[k]}${array ? ' (één per regel)' : ''}</label>${k === 'name' ? `<input id="${k}" name="${k}" maxlength="120" value="${esc(content[k] ?? '')}" required>` : `<textarea id="${k}" name="${k}" maxlength="${array ? 6000 : 2000}" ${required ? 'required' : ''}>${esc(array ? (content[k] ?? []).join('\n') : (content[k] ?? ''))}</textarea>`}</div>`;
  }
  $('detail').innerHTML =
    `<h2>${mode === 'create' ? 'Nieuwe activiteit' : mode === 'edit' ? 'Concept bewerken' : 'Nieuwe versie'}</h2><p class="step" id="steps">Stap 1 van 3 · Basisgegevens</p><form id="wizard"><fieldset data-step="0"><legend>Basisgegevens</legend>${field('name')}${field('description')}${field('purpose')}${field('legal_basis')}</fieldset><fieldset data-step="1" hidden><legend>Gegevens en systemen</legend><div class="grid">${['data_subject_categories', 'data_categories', 'processors', 'recipients', 'source_systems', 'destination_systems'].map(field).join('')}</div>${field('retention')}</fieldset><fieldset data-step="2" hidden><legend>Geldigheidsperiode</legend><p>Geldigheid loopt vanaf de begindatum tot, maar niet inclusief, de einddatum. Na publicatie staan deze datums vast.</p><label for="valid_from">Geldig vanaf</label><input id="valid_from" type="datetime-local" value="${local(from)}" required><label for="valid_until">Geldig tot (optioneel)</label><input id="valid_until" type="datetime-local" value="${local(until)}"><p class="muted">Zonder einddatum is de versie onbeperkt geldig en kan er geen overlappende opvolger worden gepubliceerd. Kies een einddatum wanneer je een opvolger verwacht.</p></fieldset><div class="actions"><button type="button" id="cancel" class="secondary">Annuleren</button><button type="button" id="back" class="secondary" hidden>Vorige</button><button type="button" id="forward">Volgende</button><button id="save" hidden>Concept opslaan</button></div></form>`;
  let step = 0;
  const display = () => {
    for (const f of $('wizard').querySelectorAll('fieldset')) {
      f.hidden = Number(f.dataset.step) !== step;
      f.disabled = f.hidden;
    }
    $('back').hidden = step === 0;
    $('forward').hidden = step === 2;
    $('save').hidden = step !== 2;
    $('steps').textContent =
      `Stap ${step + 1} van 3 · ${['Basisgegevens', 'Gegevens en systemen', 'Geldigheidsperiode'][step]}`;
    $('wizard')
      .querySelector(
        'fieldset:not([hidden]) input,fieldset:not([hidden]) textarea',
      )
      ?.focus();
  };
  $('forward').onclick = () => {
    if ($('wizard').reportValidity()) {
      step++;
      display();
    }
  };
  $('back').onclick = () => {
    step--;
    display();
  };
  $('cancel').onclick = () =>
    selected ? render() : $('detail').replaceChildren();
  $('wizard').onsubmit = run(async () => {
    if (step < 2) {
      step++;
      display();
      return;
    }
    const data = {
      content: {},
      valid_from: new Date($('valid_from').value).toISOString(),
      valid_until: $('valid_until').value
        ? new Date($('valid_until').value).toISOString()
        : null,
    };
    for (const k of Object.keys(labels).filter((k) => !k.startsWith('valid_')))
      data.content[k] = arrayKeys.includes(k)
        ? $(k)
            .value.split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : $(k).value.trim();
    let id = selected;
    if (mode === 'create') {
      const result = await api('/api/activities', 'POST', {
        ...data,
        party: me.party,
      });
      id = result.id;
    } else if (mode === 'edit')
      await api(
        `/api/activities/${selected}/versions/${source.version}`,
        'PUT',
        { ...data, revision: source.revision },
      );
    else await api(`/api/activities/${selected}/versions`, 'POST', data);
    await load();
    await open(id);
    message(
      'Concept opgeslagen. Een andere bevoegde reviewer kan deze versie publiceren.',
    );
  });
  display();
}
async function enter(actor) {
  me = actor;
  $('login').hidden = true;
  $('workspace').hidden = false;
  $('new').hidden = !hasRole('editor');
  $('identity').innerHTML =
    `<span>${esc(roleNames[me.role])}</span><button id="logout">Uitloggen</button>`;
  $('logout').onclick = run(async () => {
    await api('/api/session', 'DELETE');
    location.reload();
  });
  await load();
}
$('login-form').onsubmit = run(async () => {
  const actor = await api('/api/session', 'POST', { code: $('code').value });
  $('code').value = '';
  await enter(actor);
  message('Je bent ingelogd in de lokale demo.');
});
$('search-filters').onsubmit = (event) => event.preventDefault();
$('filter').oninput = list;
for (const id of [
  'search-field',
  'search-status',
  'search-versions',
  'search-sort',
])
  $(id).onchange = list;
$('search-filters').onreset = () => setTimeout(list, 0);
$('new').onclick = () => wizard('create');
try {
  await enter(await api('/api/me'));
} catch {
  /* Login is displayed until an authenticated session exists. */
}
