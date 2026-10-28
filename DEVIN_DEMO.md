# Devin demo: Performance fix with p50/p95/p99 proof

**What it shows:** Devin benchmarks a slow endpoint, profiles it, fixes the causes without changing the API, and reports p50, p95, p99 latency and RPS before and after.

**Needs:** GitHub only

More demos: [devin-advanced-demos](https://github.com/thequantexplorer/devin-advanced-demos)

## Set it up

1. Click **Use this template → Create a new repository**, choose your GitHub account or org as the owner, and keep the name `devin-demo-performance`. The links and prompt below assume that name. Use the template rather than a fork: pull requests on a fork go to the original repo by default.
2. In Devin, open [**Settings → Connections → GitHub**](https://app.devin.ai/settings/connections/github) and make sure Devin can access the new repository.

## Prompt

Start a new Devin session and paste this. Replace `<you>` with your GitHub user or org.

```text
Customers say the dashboard in https://github.com/<you>/devin-demo-performance is painfully slow. Make it fast, with proof.

Seed the realistic dataset (`npm run seed`) and measure the baseline with the repo's benchmark (`npm run bench`, report p50/p95/p99). Profile to find where the time actually goes (show the evidence: query counts, timings, a flamegraph or --cpu-prof output). Fix the root causes without changing response shape (existing tests must pass, add one that guards against regression). Re-run the identical benchmark and open a PR with a before/after table of p50/p95/p99 and RPS plus what you changed and why.
```
