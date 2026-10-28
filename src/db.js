const Database = require('better-sqlite3');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspaces (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, workspace_id INTEGER, name TEXT);
  CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, user_id INTEGER, ts INTEGER, props TEXT);
  -- Covering index for the dashboard: (project_id, ts) range scan without touching the events table.
  CREATE INDEX IF NOT EXISTS idx_events_dashboard ON events (project_id, ts, name, user_id, props);
  CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects (workspace_id);
`;

function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
