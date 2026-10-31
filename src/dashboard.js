// GET /api/workspaces/:id/dashboard — the customer-facing overview page.
function dashboard(db, workspaceId, sinceMs) {
  const projects = db.prepare('SELECT * FROM projects WHERE workspace_id = ?').all(workspaceId);
  const stats = new Map();
  for (const p of projects) stats.set(p.id, { events: 0, byName: {}, users: new Set(), proEvents: 0 });

  const events = db
    .prepare(
      `SELECT project_id, name, user_id, props FROM events
       WHERE project_id IN (SELECT id FROM projects WHERE workspace_id = ?) AND ts >= ?`
    )
    .all(workspaceId, sinceMs);
  for (const e of events) {
    const s = stats.get(e.project_id);
    if (!s) continue;
    s.events++;
    s.byName[e.name] = (s.byName[e.name] || 0) + 1;
    s.users.add(e.user_id);
    if (JSON.parse(e.props).plan === 'pro') s.proEvents++;
  }

  return projects.map((p) => {
    const s = stats.get(p.id);
    const topEvents = Object.entries(s.byName)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    return { projectId: p.id, name: p.name, events: s.events, uniqueUsers: s.users.size, proEvents: s.proEvents, topEvents };
  });
}

module.exports = { dashboard };
