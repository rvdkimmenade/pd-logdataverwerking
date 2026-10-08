const base = 'http://127.0.0.1:18080';
const deadline = Date.now() + 90_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${base}/api/clusters`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const clusters = await response.json();
      if (
        clusters.some(
          (cluster) =>
            cluster.name === 'ldv-local' &&
            cluster.status?.toLowerCase() === 'online',
        )
      ) {
        const page = await fetch(base, { signal: AbortSignal.timeout(5000) });
        if (
          page.ok &&
          page.headers.get('content-type')?.includes('text/html')
        ) {
          ready = true;
          break;
        }
      }
    }
  } catch {
    // Connection refusal is expected while the viewer starts.
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!ready) {
  console.error(
    'Kafbat UI or the ldv-local Kafka connection did not become ready.',
  );
  process.exitCode = 1;
} else {
  console.log(`Kafbat UI ready: ${base} — ldv-local online`);
}
