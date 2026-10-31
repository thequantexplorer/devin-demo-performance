const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { dashboard } = require('../src/dashboard');

function fixture() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO workspaces VALUES (1, 'W')").run();
  db.prepare("INSERT INTO projects VALUES (1, 1, 'A'), (2, 1, 'B'), (3, 2, 'Other')").run();
  const e = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  e.run(1, 'page_view', 1, 100, '{"plan":"pro"}');
  e.run(1, 'page_view', 2, 200, '{"plan":"free"}');
  e.run(1, 'signup', 2, 300, '{"plan":"free"}');
  e.run(1, 'page_view', 3, 5, '{"plan":"pro"}');
  e.run(2, 'search', 9, 150, '{"plan":"pro"}');
  e.run(3, 'page_view', 1, 150, '{"plan":"pro"}');
  return db;
}

test('aggregates per project since a timestamp', () => {
  assert.deepStrictEqual(dashboard(fixture(), 1, 50), [
    { projectId: 1, name: 'A', events: 3, uniqueUsers: 2, proEvents: 1, topEvents: [{ name: 'page_view', count: 2 }, { name: 'signup', count: 1 }] },
    { projectId: 2, name: 'B', events: 1, uniqueUsers: 1, proEvents: 1, topEvents: [{ name: 'search', count: 1 }] },
  ]);
});

test('empty workspace', () => {
  assert.deepStrictEqual(dashboard(fixture(), 99, 0), []);
});

function referenceDashboard(db, workspaceId, sinceMs) {
  const projects = db.prepare('SELECT * FROM projects WHERE workspace_id = ?').all(workspaceId);
  return projects.map((p) => {
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

test('keeps zero-event projects, includes the since boundary and ignores other workspaces', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects VALUES (1, 1, 'A'), (2, 1, 'Empty'), (3, 2, 'Other'), (4, 1, 'OnlyOld')").run();
  const e = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  e.run(1, 'signup', 1, 100, '{"plan":"pro"}');
  e.run(1, 'signup', 1, 99, '{"plan":"pro"}');
  e.run(3, 'signup', 1, 500, '{"plan":"pro"}');
  e.run(4, 'signup', 1, 10, '{"plan":"pro"}');
  assert.deepStrictEqual(dashboard(db, 1, 100), [
    { projectId: 1, name: 'A', events: 1, uniqueUsers: 1, proEvents: 1, topEvents: [{ name: 'signup', count: 1 }] },
    { projectId: 2, name: 'Empty', events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] },
    { projectId: 4, name: 'OnlyOld', events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] },
  ]);
});

test('strict pro matching, unique users and top-3 count/name ordering', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects VALUES (1, 1, 'A')").run();
  const e = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  const plans = ['{"plan":"pro"}', '{"plan":"Pro"}', '{"plan":"pro "}', '{"plan":["pro"]}', '{}', '{"tier":"pro"}'];
  plans.forEach((props, i) => e.run(1, 'zeta', i % 2, 1, props));
  e.run(1, 'beta', 7, 1, '{}');
  e.run(1, 'beta', 7, 1, '{}');
  e.run(1, 'alpha', 8, 1, '{}');
  e.run(1, 'alpha', 8, 1, '{}');
  e.run(1, 'gamma', 9, 1, '{}');
  const [row] = dashboard(db, 1, 0);
  assert.strictEqual(row.events, 11);
  assert.strictEqual(row.uniqueUsers, 5);
  assert.strictEqual(row.proEvents, 1);
  assert.deepStrictEqual(row.topEvents, [{ name: 'zeta', count: 6 }, { name: 'alpha', count: 2 }, { name: 'beta', count: 2 }]);
});

test('fetches all workspace events with a single events query', () => {
  const db = fixture();
  const sql = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (s) => (sql.push(s), prepare(s));
  dashboard(db, 1, 0);
  assert.strictEqual(sql.filter((s) => /FROM events/i.test(s)).length, 1);
});

test('matches the per-project reference on a randomized dataset', () => {
  const db = openDb(':memory:');
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const names = ['page_view', 'signup', 'checkout', 'search', 'share', 'invite_sent'];
  const insP = db.prepare('INSERT INTO projects (id, workspace_id, name) VALUES (?, ?, ?)');
  const insE = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (let p = 1; p <= 30; p++) insP.run(p, 1 + (p % 3), 'P' + p);
    for (let i = 0; i < 5000; i++) {
      insE.run(1 + Math.floor(rnd() * 32), names[Math.floor(rnd() * 6)], Math.floor(rnd() * 200), Math.floor(rnd() * 1000), JSON.stringify({ plan: rnd() < 0.2 ? 'pro' : 'free' }));
    }
  })();
  for (const w of [1, 2, 3, 4]) {
    for (const since of [0, 500, 999, 1000]) assert.deepStrictEqual(dashboard(db, w, since), referenceDashboard(db, w, since));
  }
});
