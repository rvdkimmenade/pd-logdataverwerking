const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const time = (value) => new Date(value).toLocaleString('nl-NL');
let filters = {},
  cursor = null,
  traceCursor = null,
  currentTrace,
  currentPageFilters = {};
function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = error ? 'error' : '';
  $('message').setAttribute('role', error ? 'alert' : 'status');
}
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      {
        AUTH_REQUIRED: 'Je sessie is verlopen. Log opnieuw in.',
        FORBIDDEN: 'Je hebt geen recht op deze gegevens.',
        INVALID_REQUEST: 'Controleer de filters en datums.',
        NOT_FOUND: 'Deze gebeurtenis is niet beschikbaar.',
        UNAVAILABLE:
          'Een afhankelijkheid is tijdelijk niet beschikbaar. Probeer opnieuw.',
      }[data.code] ?? 'De actie kon niet worden uitgevoerd.',
    );
  return data;
}
const run = (fn) => async (e) => {
  e?.preventDefault();
  message('');
  try {
    await fn(e);
  } catch (error) {
    message(error.message, true);
  }
};
async function search(body) {
  const page = await api('/api/logs/search', body);
  currentPageFilters = body;
  $('export').disabled = false;
  cursor = page.next_cursor;
  $('rows').replaceChildren();
  $('results').hidden = !page.items.length;
  $('empty').hidden = !!page.items.length;
  $('empty').textContent =
    'Geen gebeurtenissen gevonden binnen je scope en filters.';
  $('count').textContent = `${page.items.length} op deze pagina`;
  $('next').hidden = !cursor;
  for (const item of page.items) {
    const p = item.envelope.payload;
    const row = document.createElement('tr');
    row.innerHTML = `<td>${esc(time(p.start_time))}</td><td>${esc(item.envelope.source_application)}</td><td>${esc(item.processing_activity.content?.name ?? p.attributes['dpl.core.processing_activity_id'])}</td><td>${esc(p.status ?? '—')}</td><td><button data-detail>Details</button><button class="secondary" data-trace>Trace</button></td>`;
    row.querySelector('[data-detail]').onclick = run(() =>
      detail(item.event_id),
    );
    row.querySelector('[data-trace]').onclick = run(() => trace(p.trace_id));
    $('rows').append(row);
  }
}
async function detail(id) {
  const item = await api(`/api/logs/${id}`);
  const p = item.envelope.payload;
  const r = item.processing_activity;
  $('detail').innerHTML =
    `<h2>Context en origineel</h2><dl><dt>Event-ID</dt><dd>${esc(id)}</dd><dt>Tijdstip</dt><dd>${esc(time(p.start_time))}</dd><dt>Opgeslagen</dt><dd>${esc(time(item.stored_at))}</dd><dt>SHA-256</dt><dd>${esc(item.sha256)}</dd><dt>Registercontext</dt><dd>${esc(r.status)} ${r.version ? `· versie ${esc(r.version)}` : ''}</dd></dl>${r.version ? `<h3>Historische registerversie</h3><pre>${esc(JSON.stringify(r, null, 2))}</pre>` : '<p>Geen ondersteunde registerversie voor dit eventtijdstip.</p>'}<h3>Originele logregel</h3><pre>${esc(JSON.stringify(item.envelope, null, 2))}</pre>`;
  $('detail').setAttribute('tabindex', '-1');
  $('detail').focus();
}
async function trace(id, more = false) {
  if (!more) {
    currentTrace = id;
    $('spans').replaceChildren();
    traceCursor = null;
  }
  const page = await api(`/api/traces/${id}`, {
    limit: 100,
    ...(traceCursor ? { cursor: traceCursor } : {}),
  });
  traceCursor = page.next_cursor;
  $('trace').hidden = false;
  $('trace-next').hidden = !traceCursor;
  $('trace-note').textContent =
    `Trace ${id}. Alleen spans binnen je scope worden getoond; een parent kan buiten de zichtbare scope of pagina vallen.`;
  for (const item of page.items) {
    const p = item.envelope.payload;
    const li = document.createElement('li');
    li.innerHTML = `<strong>${esc(time(p.start_time))} · ${esc(item.envelope.source_application)}</strong><p>Span ${esc(p.span_id)}${p.parent_span_id ? ` · parent ${esc(p.parent_span_id)}` : ' · root'}</p><p>Subject ${esc(p.attributes['dpl.core.data_subject_id'] ?? '—')}</p><button>Details</button>`;
    li.style.marginLeft = p.parent_span_id ? '24px' : '0';
    li.querySelector('button').onclick = run(() => detail(item.event_id));
    $('spans').append(li);
  }
  if (!more) $('trace').scrollIntoView({ behavior: 'smooth' });
}
$('search').onsubmit = run(async () => {
  filters = { limit: 25 };
  for (const [key, value] of new FormData($('search'))) {
    if (!value) continue;
    filters[key] =
      key === 'from' || key === 'until' ? new Date(value).getTime() : value;
  }
  await search(filters);
});
$('next').onclick = run(() => search({ ...filters, cursor }));
async function pipeline() {
  const data = await api('/api/operations');
  $('pipeline').hidden = false;
  const metrics = data.projector;
  $('pipeline-summary').innerHTML =
    `<dt>Archiefconsumerachterstand</dt><dd>${esc(data.archive_consumer_lag)} Kafka-records</dd><dt>Offsetstand</dt><dd>${esc(data.consumer_offset)} / ${esc(data.end_offset)}</dd><dt>Projectorscanleeftijd</dt><dd>${metrics.scan_lag_ms == null ? 'Nog geen geslaagde scan' : `${esc(Math.round(metrics.scan_lag_ms / 1000))} seconden`}</dd><dt>Projectorfouten</dt><dd>${esc(metrics.failures)}</dd><dt>Momentopname</dt><dd>${esc(time(data.observed_at))}</dd>`;
  $('failure-status').textContent =
    `Foutfeed: ${data.feed_status}. Maximaal 100 waargenomen metadataregels; dit is geen volledig foutarchief.${data.expired_unprocessed ? ' Waarschuwing: ongelezen Kafka-offsets zijn verlopen.' : ''}`;
  $('failures').innerHTML = data.failures
    .map(
      (f) =>
        `<tr><td>${esc(time(f.observed_at))}</td><td>${esc(f.kind)}</td><td>${esc(f.reason)}</td><td>${esc(f.source_partition)}:${esc(f.source_offset)}</td></tr>`,
    )
    .join('');
  $('pipeline').scrollIntoView({ behavior: 'smooth' });
}
$('operations').onclick = run(pipeline);
$('refresh-pipeline').onclick = run(pipeline);
$('trace-next').onclick = run(() => trace(currentTrace, true));
$('export').onclick = run(async () => {
  const file = await api('/api/logs/export', currentPageFilters);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ldv-export.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(
    'Deze pagina is geëxporteerd. De export bevat scope en exportmoment.',
  );
});
try {
  const me = await api('/api/me');
  $('login').hidden = true;
  const roleName =
    me.roles?.includes('editor') && me.roles?.includes('reviewer')
      ? 'Admin'
      : me.permissions.includes('log.export')
        ? 'Auditor'
        : me.permissions.includes('log.read')
          ? 'Onderzoeker'
          : me.permissions.includes('operations')
            ? 'Technisch beheerder'
            : {
                editor: 'Registerbeheerder',
                reviewer: 'Privacy reviewer',
                reader: 'Registerlezer',
              }[me.role];
  $('identity').innerHTML =
    `<span>${esc(roleName)}</span> <button id="logout">Uitloggen</button>`;
  $('logout').onclick = run(async () => {
    await api('/api/session', undefined, 'DELETE');
    location.reload();
  });
  $('register-link').hidden = !me.permissions.includes('register');
  $('operations').hidden = !me.permissions.includes('operations');
  $('workspace').hidden = !me.permissions.includes('log.read');
  $('export').hidden = !me.permissions.includes('log.export');
  for (const app of me.applications) {
    const option = document.createElement('option');
    option.value = app;
    option.textContent = app;
    $('applications').append(option);
  }
  if (!me.permissions.includes('log.read'))
    message(
      'Je rol heeft geen logboekinzage. Gebruik de beschikbare navigatie.',
    );
} catch {
  /* Authentication prompt stays visible. */
}
