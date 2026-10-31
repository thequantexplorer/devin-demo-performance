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

// Reference: the original per-project JS aggregation the SQL version must match.
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

test('keeps projects with no events since the timestamp', () => {
  const db = fixture();
  db.prepare("INSERT INTO projects VALUES (4, 1, 'Empty')").run();
  assert.deepStrictEqual(dashboard(db, 1, 250), [
    { projectId: 1, name: 'A', events: 1, uniqueUsers: 1, proEvents: 0, topEvents: [{ name: 'signup', count: 1 }] },
    { projectId: 2, name: 'B', events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] },
    { projectId: 4, name: 'Empty', events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] },
  ]);
});

test('since boundary is inclusive', () => {
  const [a] = dashboard(fixture(), 1, 300);
  assert.deepStrictEqual(a, { projectId: 1, name: 'A', events: 1, uniqueUsers: 1, proEvents: 0, topEvents: [{ name: 'signup', count: 1 }] });
});

test('counts unique users and strict pro plans, top 3 by count then name', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects VALUES (1, 1, 'A')").run();
  const e = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  const props = ['{"plan":"pro"}', '{"plan":"Pro"}', '{"plan":"pro "}', '{"plan":true}', '{"meta":{"plan":"pro"}}', '{}', '{"plan":"pro","x":1}'];
  props.forEach((p, i) => e.run(1, ['b', 'c', 'a', 'd', 'b', 'c', 'a'][i], i % 3, 10, p));
  e.run(1, 'zz', null, 10, '{}');
  e.run(1, 'zz', null, 10, '{}');
  const expected = { projectId: 1, name: 'A', events: 9, uniqueUsers: 4, proEvents: 2, topEvents: [{ name: 'a', count: 2 }, { name: 'b', count: 2 }, { name: 'c', count: 2 }] };
  assert.deepStrictEqual(dashboard(db, 1, 0), [expected]);
  assert.deepStrictEqual(reference(db, 1, 0), [expected]);
});

test('matches the reference aggregation on randomized data', () => {
  const db = openDb(':memory:');
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const names = ['page_view', 'signup', 'checkout', 'search', 'share', 'invite_sent', 'Search', 'é'];
  for (let p = 1; p <= 30; p++) db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(p, 1 + (p % 3), 'P' + p);
  const e = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 5000; i++) {
    e.run(1 + Math.floor(rnd() * 28), names[Math.floor(rnd() * names.length)], Math.floor(rnd() * 200), Math.floor(rnd() * 1000), JSON.stringify({ plan: rnd() < 0.3 ? 'pro' : 'free' }));
  }
  for (const w of [1, 2, 3, 4]) for (const since of [0, 250, 500, 999, 1000]) assert.deepStrictEqual(dashboard(db, w, since), reference(db, w, since));
});

test('runs a fixed number of queries regardless of project count', () => {
  const db = fixture();
  for (let p = 10; p < 40; p++) db.prepare('INSERT INTO projects VALUES (?, 1, ?)').run(p, 'P' + p);
  let executions = 0;
  const spy = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return { all: (...args) => (executions++, stmt.all(...args)) };
    },
  };
  assert.strictEqual(dashboard(spy, 1, 0).length, 32);
  assert.strictEqual(executions, 2);
});
