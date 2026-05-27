# Flaky-Test Triage & Quarantine Agent — Build Document

> **Status:** Planning
> **Hackathon:** Build with Gemini XPRIZE — Small Business Services category
> **Deadline:** Aug 17, 2026 @ 1:00pm PDT (~90 days)
> **Owner:** Ronak
> **Goal:** Ship a live, AI-operated utility for CI flakiness triage. Primary win condition = a working, demoable, adopted-by-a-few utility + credibility artifact. Prize is a bonus.

---

## 1. The Idea in One Sentence

An agent that watches a project's CI runs, detects which test failures are **flaky** (non-deterministic) versus **real** breaks, explains the likely root cause, and quarantines flaky tests so the build stays trustworthy — with a human in the loop until the agent earns autonomy.

### Why this one
- Universal, undignified pain: every team with CI hates flaky tests; almost nobody handles them well.
- **Not** "another test-writing agent" — it's a utility that owns the triage/maintenance loop *around* tests.
- Low adoption friction: install an app, point it at a repo.
- Plays directly to Ronak's QE/CI-reliability expertise → airtight hackathon narrative.
- Doubles as live R&D for AI-agent reliability thinking relevant to the DV day job.

---

## 2. Win Condition & Scope Philosophy

| Dimension | Target |
|---|---|
| Real win condition | Working utility, live, demoable end-to-end against a real repo |
| Stretch | 3–5 small teams / indie devs trying it; token revenue on a paid tier |
| Hackathon submission needs | GitHub repo, 3-min video, 500–1000 word narrative, evidence of AI running in production (agent logs, API usage), any customer/revenue evidence |

**Scope discipline is the #1 risk.** Test result formats and CI quirks are a swamp. MVP supports **JUnit XML + GitHub Actions only**. Say so explicitly. Breadth is where these projects die.

---

## 3. Core Architecture

### The two-loop split (build in this order)

**Loop A — Explain (read-only, low-stakes, ship first)**
- Observes a failure, posts a root-cause hypothesis as a PR comment.
- Worst case = a wrong comment. Safe to run fully autonomously from day one.

**Loop B — Act (write-access, higher-stakes, earns autonomy gradually)**
- Quarantine / un-quarantine flaky tests.
- Autonomy ladder:
  1. Agent proposes, human one-clicks to confirm.
  2. Auto-quarantine with notification (after trust is established).
  3. Auto-un-quarantine when a test stabilizes.
- This staged autonomy IS the hackathon's "what AI does vs. what humans do" narrative — calibrated trust, not blind automation.

### The trust backbone: stats decide, LLM explains

> **Critical design principle:** the LLM does **not** decide *whether* to quarantine. Deterministic statistics + thresholds make that call. Gemini does the language/reasoning the stats can't.

**Deterministic flakiness signal (the ground truth):**
A test is flaky if it produces different results without a relevant code change.
- Failed then **passed on retry at the same commit SHA** → near-certain flaky.
- Intermittent failures across SHAs that don't touch the test's code path → probably flaky.
- **Consistent** failure after a specific commit → a REAL break. Must **never** be quarantined.

**Gemini sits on top, for what stats can't do:**
- Read failure logs to hypothesize *why* it's flaky (timing/async, test-order dependency, external dependency, resource contention).
- Write the human-readable explanation comment.
- Draft the tracking ticket.
- Produce the quarantine *recommendation rationale* (recommend, not decide).

This separation is what makes autonomous action trustworthy — and is a genuinely good agent-architecture lesson.

---

## 4. Tech Stack

Hackathon requires Gemini + at least one Google Cloud product.

| Layer | Choice | Notes |
|---|---|---|
| Reasoning / language | **Gemini API** | Log analysis, root-cause hypothesis, explanation comments, ticket drafting, recommendation rationale |
| Service host | **Cloud Run** | Receives CI webhook events, posts back. Scales to zero, cheap. |
| Test-history store | **Firestore** or **BigQuery** | Per-test run history. BigQuery is familiar to Ronak + enables flakiness-trend dashboards. |
| Integration surface | **GitHub App** (or Action) | Where indie devs / small teams live. Gives workflow events, log API, PR comments, issue creation in one place. |

Pick **one** CI provider for the MVP (GitHub Actions). GitLab is a fine later alternative.

---

## 5. 90-Day Plan

### Phase 0 — Demo repo (prerequisite, do early)
No public repo with tests available (prior/current employer repos are proprietary and off-limits). **Build a purpose-made demo app + test suite.**
- A purpose-built repo is *better* than a real one: deliberately plant flaky tests by **category** so the agent can prove it catches each one. Far more convincing in the 3-min video and fully controllable.
- Plant at least: async/race flake, test-order-dependency flake, external-dependency/timeout flake, resource-contention flake.
- Include genuinely-passing tests and at least one *real* (deterministic) failure to prove the agent does NOT quarantine real breaks.

### Week 1 — Ingestion (no intelligence yet)
- GitHub App receives "workflow run completed".
- Parse test results from **JUnit XML**.
- Store per-test run history (name, status, duration, commit SHA, branch, failure log) in Firestore/BigQuery.
- Prove reliable ingestion on the demo repo.

### Week 2 — Loop A: Explain (read-only, autonomous)
- On a failure, Gemini reads log + diff → posts a PR comment with a root-cause hypothesis.
- Demoable and useful on its own. **Ship it.**

### Week 3 — Loop B (MVP): Detect + Recommend
- Flakiness scoring layer: detect same-SHA pass/fail, compute scores.
- Post "this looks flaky (NN%), here's why — [Quarantine] button."
- Human clicks to confirm.
- **This is the MVP:** observes → explains → detects flakiness → acts with human in the loop.

### Post-MVP (polish + final-video material)
- Auto-quarantine (autonomy ladder step 2).
- Auto-un-quarantine when stable (step 3).
- Slack alerts.
- Multi-repo dashboard + flakiness-trend charts.
- Paid tier.

---

## 6. Monetization (for the hackathon's "real revenue" check)
Even with zero paying users, this is a credibility asset. If pursuing revenue:
- Free GitHub Action / app tier that's genuinely useful (earn goodwill first).
- Paid tier: dashboard, history, multi-repo, Slack alerts.
- Realistic 90-day target: a few small teams / indie devs at ~$10–20/mo.
- Disclose marketing/customer-acquisition spend even if zero (hackathon requires it).

---

## 7. Open Questions / To-Decide
- [ ] Firestore vs. BigQuery for history store (lean BigQuery for dashboards + familiarity?)
- [ ] GitHub App vs. GitHub Action as the install surface
- [ ] Demo app: what language/framework? (pick something with clean JUnit-XML output)
- [ ] How quarantine is technically applied (skip annotation? config file? framework-specific?) — research per ecosystem
- [ ] Flakiness score thresholds for each autonomy rung

## 8. Submission Checklist (Aug 17)
- [ ] GitHub repo shared with testing@devpost.com and judging@hacker.fund
- [ ] 3-minute video showing AI live in production making key decisions
- [ ] Written narrative (500–1000 words): AI vs. human roles, economic opportunity, build story
- [ ] Revenue evidence (Stripe export / bank statement / P&L) — even if minimal
- [ ] Expense disclosure (marketing/customer acquisition, even if $0)
- [ ] Product evidence: agent execution logs, API usage records, dashboard screenshots
- [ ] Customer evidence: real customer contacts / testimonials (if any)

---

## Changelog
- _(start dating entries here as you make progress)_
