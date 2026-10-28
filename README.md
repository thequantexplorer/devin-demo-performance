# acme-analytics-api

Serves the customer dashboard (`GET /api/workspaces/:id/dashboard`): per-project event counts, unique users, pro-plan events and top events since a date.

```sh
npm install
npm run seed     # builds analytics.db (~400k events)
npm start        # :4500
npm run bench    # autocannon load test, prints p50/p95/p99
npm test
```

Customers on big workspaces report the dashboard takes seconds to load. SLO: p95 < 150 ms at 10 concurrent users.

---

This repo is a starter for a Devin demo. See [DEVIN_DEMO.md](DEVIN_DEMO.md) for setup and the prompt.
