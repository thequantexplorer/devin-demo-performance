// GET /api/workspaces/:id/dashboard — the customer-facing overview page.
function dashboard(db, workspaceId, sinceMs) {
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

module.exports = { dashboard };
