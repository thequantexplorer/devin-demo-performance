const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { dashboard } = require('../src/dashboard');

// Original per-project implementation, kept as the reference for response shape and values.
function reference(db, workspaceId, sinceMs) {
  return db.prepare('SELECT * FROM projects WHERE workspace_id = ?').all(workspaceId).map((p) => {
    const events = db.prepare('SELECT * FROM events WHERE project_id = ? AND ts >= ?').all(p.id, sinceMs);
    const byName = {};
    const users = new Set();
    let proEvents = 0;
    for (const e of events) {
      byName[e.name] = (byName[e.name] || 0) + 1;
      users.add(e.user_id);
      if (JSON.parse(e.props).plan === 'pro') proEvents++;
    }
    const topEvents = Object.entries(byName)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    return { projectId: p.id, name: p.name, events: events.length, uniqueUsers: users.size, proEvents, topEvents };
  });
}

function randomDb(projectsPerWorkspace) {
  const db = openDb(':memory:');
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const names = ['page_view', 'signup', 'checkout', 'search', 'share', 'invite_sent'];
  const insP = db.prepare('INSERT INTO projects (id, workspace_id, name) VALUES (?, ?, ?)');
  const insE = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (let w = 1; w <= 3; w++) for (let p = 0; p < projectsPerWorkspace; p++) insP.run((w - 1) * projectsPerWorkspace + p + 1, w, `P${w}-${p}`);
    for (let i = 0; i < 5000; i++) {
      // Leave the last project of each workspace empty.
      const project = 1 + Math.floor(rnd() * (3 * projectsPerWorkspace));
      if (project % projectsPerWorkspace === 0) continue;
      insE.run(project, names[Math.floor(rnd() * names.length)], Math.floor(rnd() * 300), Math.floor(rnd() * 1000), JSON.stringify({ plan: rnd() < 0.2 ? 'pro' : 'free' }));
    }
  })();
  return db;
}

function countQueries(db) {
  let n = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = prepare(sql);
    for (const m of ['all', 'get', 'iterate']) {
      const orig = stmt[m].bind(stmt);
      stmt[m] = (...args) => (n++, orig(...args));
    }
    return stmt;
  };
  return () => n;
}

test('matches the per-project reference implementation', () => {
  const db = randomDb(8);
  for (const w of [1, 2, 3, 99]) for (const since of [0, 500, 2000]) assert.deepStrictEqual(dashboard(db, w, since), reference(db, w, since));
});

test('query count does not grow with project count (no N+1)', () => {
  const run = (projects) => {
    const db = randomDb(projects);
    const queries = countQueries(db);
    dashboard(db, 1, 0);
    return queries();
  };
  const small = run(2);
  assert.ok(small <= 3, `expected <= 3 queries, got ${small}`);
  assert.strictEqual(run(40), small);
});

test('dashboard queries never full-scan the events table', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects VALUES (1, 1, 'A')").run();
  const sqls = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => (sqls.push(sql), prepare(sql));
  dashboard(db, 1, 0);
  assert.ok(sqls.length > 0);
  for (const sql of sqls) {
    const params = (sql.match(/\?/g) || []).map(() => 0);
    const plan = prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map((r) => r.detail).join('\n');
    assert.doesNotMatch(plan, /SCAN (events|e)\b/, `full scan of events in:\n${sql}\n${plan}`);
  }
});
