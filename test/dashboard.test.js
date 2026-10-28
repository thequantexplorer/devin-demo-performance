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
