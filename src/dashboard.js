// GET /api/workspaces/:id/dashboard — the customer-facing overview page.
// One workspace-scoped aggregate query: the filtered events are scanned once into a
// materialized CTE, then grouped per project (totals) and per project+name (top events).
//
// `pro` mirrors `JSON.parse(props).plan === 'pro'`: props must be strict JSON (no JSON5),
// SQL NULL / JSON null fail the query like the original TypeError, and duplicate top-level
// `plan` keys resolve to the last occurrence (json_each; json_extract would pick the first).
// Fast path: with no escapes and at most one literal "plan" there can be no duplicate key.
// The ELSE branch raises "malformed JSON".
const AGGREGATE_SQL = `
  WITH ev AS MATERIALIZED (
    SELECT project_id AS pid, name, user_id AS uid,
      CASE WHEN json_valid(props, 1) AND json_type(props) <> 'null' THEN
        CASE WHEN instr(props, '\\') = 0 AND length(props) - length(replace(props, '"plan"', '')) <= 6
          THEN coalesce(json_extract(props, '$.plan') = 'pro', 0)
          ELSE coalesce((SELECT type = 'text' AND value = 'pro' FROM json_each(props) WHERE key = 'plan' ORDER BY id DESC LIMIT 1), 0)
        END
      ELSE json('{,' || ifnull(props, '')) END AS pro
    FROM events
    WHERE ts >= @since AND project_id IN (SELECT id FROM projects WHERE workspace_id = @workspaceId)
  )
  SELECT pid, 0 AS byName, NULL AS name, COUNT(*) AS n,
         COUNT(DISTINCT uid) + MAX(uid IS NULL) AS users, TOTAL(pro) AS pro
  FROM ev GROUP BY pid
  UNION ALL
  SELECT pid, 1, name, COUNT(*), NULL, NULL
  FROM ev GROUP BY pid, name
`;

const statements = new WeakMap();

function prepared(db) {
  let s = statements.get(db);
  if (!s) {
    s = {
      projects: db.prepare('SELECT * FROM projects WHERE workspace_id = ?'),
      aggregate: db.prepare(AGGREGATE_SQL),
    };
    statements.set(db, s);
  }
  return s;
}

function dashboard(db, workspaceId, sinceMs) {
  const { projects, aggregate } = prepared(db);
  const rows = projects.all(workspaceId);
  if (rows.length === 0) return [];

  const stats = new Map();
  const statsFor = (pid) => {
    let st = stats.get(pid);
    if (!st) stats.set(pid, (st = { events: 0, uniqueUsers: 0, proEvents: 0, byName: new Map() }));
    return st;
  };
  for (const r of aggregate.all({ workspaceId, since: sinceMs })) {
    const st = statsFor(r.pid);
    if (r.byName) {
      // Object keys in the original were String(name); merge groups that stringify alike (e.g. NULL and 'null').
      const key = String(r.name);
      st.byName.set(key, (st.byName.get(key) || 0) + r.n);
    } else {
      st.events = r.n;
      st.uniqueUsers = r.users;
      st.proEvents = r.pro;
    }
  }

  return rows.map((p) => {
    const st = stats.get(p.id);
    if (!st) return { projectId: p.id, name: p.name, events: 0, uniqueUsers: 0, proEvents: 0, topEvents: [] };
    const topEvents = [...st.byName]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
    return { projectId: p.id, name: p.name, events: st.events, uniqueUsers: st.uniqueUsers, proEvents: st.proEvents, topEvents };
  });
}

module.exports = { dashboard };
