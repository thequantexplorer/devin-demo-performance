const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDb } = require('../src/db');
const { dashboard } = require('../src/dashboard');

const EVENTS_QUERY = 'SELECT * FROM events WHERE project_id = ? AND ts >= ?';

test('schema creates a (project_id, ts) index on events', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("SELECT name FROM pragma_index_info('idx_events_project_ts')").all().map((c) => c.name);
  assert.deepStrictEqual(cols, ['project_id', 'ts']);
});

test('dashboard event lookup uses the index instead of a full scan', () => {
  const db = openDb(':memory:');
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + EVENTS_QUERY).all(1, 0).map((r) => r.detail).join('\n');
  assert.match(plan, /SEARCH events USING INDEX idx_events_project_ts \(project_id=\? AND ts>\?\)/);
  assert.doesNotMatch(plan, /SCAN events/);
});

test('openDb adds the index to an existing database created without it', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'idx-')), 'legacy.db');
  const legacy = new Database(file);
  legacy.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, user_id INTEGER, ts INTEGER, props TEXT)');
  legacy.close();
  const db = openDb(file);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all().map((r) => r.name);
  assert.ok(idx.includes('idx_events_project_ts'));
  db.close();
});

test('response semantics are unchanged with the index', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO workspaces VALUES (1, 'W')").run();
  db.prepare("INSERT INTO projects VALUES (1, 1, 'A'), (2, 1, 'Empty'), (3, 1, 'Old')").run();
  const e = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
  e.run(1, 'b', 1, 1000, '{"plan":"pro"}');
  e.run(1, 'b', 1, 1001, '{"plan":"Pro"}');
  e.run(1, 'a', 2, 1002, '{"plan":"pro "}');
  e.run(1, 'a', 3, 1003, '{"plan":"free"}');
  e.run(1, 'c', 3, 1004, '{"plan":"pro","x":1}');
  e.run(1, 'd', 4, 1005, '{}');
  e.run(1, 'z', 5, 999, '{"plan":"pro"}');
  e.run(3, 'a', 1, 10, '{"plan":"pro"}');
  assert.deepStrictEqual(dashboard(db, 1, 1000), [
    { projectId: 1, name: 'A', events: 6, uniqueUsers: 4, proEvents: 2, topEvents: [{ name: 'a', count: 2 }, { name: 'b', count: 2 }, { name: 'c', count: 1 }] },
    { projectId: 2, name: 'Empty', events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] },
    { projectId: 3, name: 'Old', events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] },
  ]);
});
