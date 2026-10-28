// Starts the API on the seeded DB and load-tests the dashboard endpoint. Prints p50/p95/p99 latency.
const autocannon = require('autocannon');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');

const server = createApp(openDb(process.env.DB_FILE || 'analytics.db')).listen(0, async () => {
  const { port } = server.address();
  const result = await autocannon({
    url: `http://127.0.0.1:${port}`,
    connections: 10,
    duration: Number(process.env.DURATION || 15),
    requests: [{ setupRequest: (r) => ({ ...r, path: `/api/workspaces/${1 + Math.floor(Math.random() * 20)}/dashboard` }) }],
  });
  const l = result.latency;
  console.log(JSON.stringify({ requests: result.requests.total, rps: result.requests.average, p50_ms: l.p50, p95_ms: l.p97_5 ?? l.p95, p99_ms: l.p99, errors: result.errors, non2xx: result.non2xx }, null, 2));
  server.close();
});
