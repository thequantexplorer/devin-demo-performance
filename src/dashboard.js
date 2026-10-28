// GET /api/workspaces/:id/dashboard — the customer-facing overview page.
// Aggregates in SQLite with two grouped queries served by the covering index idx_events_dashboard,
// instead of loading every event row into JS once per project.
const statements = new WeakMap();

function prepare(db) {
  let s = statements.get(db);
  if (!s) {
    s = {
      projects: db.prepare('SELECT id, name FROM projects WHERE workspace_id = ?'),
      byName: db.prepare(`
        SELECT e.project_id AS projectId, e.name AS name, COUNT(*) AS count,
               SUM(json_extract(e.props, '$.plan') = 'pro') AS pro
        FROM projects p JOIN events e ON e.project_id = p.id
        WHERE p.workspace_id = ? AND e.ts >= ?
        GROUP BY e.project_id, e.name`),
      users: db.prepare(`
        SELECT e.project_id AS projectId, COUNT(DISTINCT e.user_id) + MAX(e.user_id IS NULL) AS uniqueUsers
        FROM projects p JOIN events e ON e.project_id = p.id
        WHERE p.workspace_id = ? AND e.ts >= ?
        GROUP BY e.project_id`),
    };
    statements.set(db, s);
  }
  return s;
}

function dashboard(db, workspaceId, sinceMs) {
  const s = prepare(db);
  const projects = s.projects.all(workspaceId);
  const users = new Map(s.users.all(workspaceId, sinceMs).map((r) => [r.projectId, r.uniqueUsers]));
  const stats = new Map();
  for (const r of s.byName.all(workspaceId, sinceMs)) {
    let st = stats.get(r.projectId);
    if (!st) stats.set(r.projectId, (st = { events: 0, proEvents: 0, names: [] }));
    st.events += r.count;
    st.proEvents += r.pro;
    st.names.push([String(r.name), r.count]);
  }
  return projects.map((p) => {
    const st = stats.get(p.id) || { events: 0, proEvents: 0, names: [] };
    const topEvents = st.names
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    return {
      projectId: p.id,
      name: p.name,
      events: st.events,
      uniqueUsers: users.get(p.id) || 0,
      proEvents: st.proEvents,
      topEvents,
    };
  });
}

module.exports = { dashboard };
