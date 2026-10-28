const express = require('express');
const { dashboard } = require('./dashboard');

function createApp(db) {
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/api/workspaces/:id/dashboard', (req, res) => {
    const since = Number(req.query.since || Date.UTC(2026, 8, 15));
    res.json({ workspaceId: Number(req.params.id), since, projects: dashboard(db, Number(req.params.id), since) });
  });
  return app;
}

module.exports = { createApp };
