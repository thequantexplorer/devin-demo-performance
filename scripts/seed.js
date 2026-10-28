// Deterministic seed: 20 workspaces x 12 projects, ~400k events over 30 days.
const { openDb } = require('../src/db');
const fs = require('fs');
const file = process.env.DB_FILE || 'analytics.db';
const events = Number(process.env.EVENTS || 400000);
for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = openDb(file);
let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const names = ['page_view', 'signup', 'checkout', 'search', 'share', 'invite_sent'];
const insW = db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)');
const insP = db.prepare('INSERT INTO projects (id, workspace_id, name) VALUES (?, ?, ?)');
const insE = db.prepare('INSERT INTO events (project_id, name, user_id, ts, props) VALUES (?, ?, ?, ?, ?)');
const start = Date.UTC(2026, 8, 1);
db.transaction(() => {
  for (let w = 1; w <= 20; w++) {
    insW.run(w, 'Workspace ' + w);
    for (let p = 0; p < 12; p++) insP.run((w - 1) * 12 + p + 1, w, `Project ${w}-${p + 1}`);
  }
  for (let i = 0; i < events; i++) {
    const project = 1 + Math.floor(rnd() * 240);
    const name = names[Math.floor(rnd() * names.length)];
    insE.run(project, name, Math.floor(rnd() * 20000), start + Math.floor(rnd() * 30 * 86400000), JSON.stringify({ plan: rnd() < 0.2 ? 'pro' : 'free', path: '/p/' + Math.floor(rnd() * 50) }));
  }
})();
console.log(`seeded ${file}: ${events} events`);
