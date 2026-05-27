# Flaky Test Triage & Quarantine Agent — Design Spec

> **Date:** 2026-05-25
> **Owner:** Ronak
> **Status:** Approved
> **Goal:** Build a working utility that watches CI runs, detects flaky vs real test failures, explains root causes, and quarantines flaky tests — with a human in the loop.

---

## 1. Problem Statement

Flaky tests erode CI trust. Developers start re-running pipelines reflexively, ignoring failures, and eventually real regressions slip through. Most teams handle flaky tests poorly — either manually tracking them or just deleting them.

No good standalone tool exists for teams on GitHub Actions that can:
1. Tell you **that** a test is flaky (statistical detection)
2. Tell you **why** it's flaky (LLM-powered root-cause analysis)
3. **Do something about it** (quarantine with human confirmation)

## 2. Core Design Principle

> **Stats decide, LLM explains.**

The LLM does **not** decide whether to quarantine. Deterministic statistics + thresholds make that call. The LLM handles what stats can't: reading failure logs, hypothesizing root causes, writing human-readable explanations, and drafting the quarantine rationale.

This separation is what makes autonomous action trustworthy.

## 3. Two-Repo Structure

### `flaky-demo-app` (separate repo)
A task management app purpose-built to demonstrate and validate the agent.

- **Stack:** Express API + SQLite (better-sqlite3) + React frontend (single page)
- **Test layers:** Unit (Vitest), Integration (Vitest + real SQLite), API (Vitest + Supertest), E2E (Playwright)
- **CI:** GitHub Actions producing JUnit XML artifacts (one per test layer)
- **Purpose:** Contains 14 planted test scenarios (10 flaky, 4 real failures) plus ~15-20 healthy tests

### `flaky-triager` (this repo)
The agent itself, built in TypeScript.

- **Core library:** JUnit XML parser, flakiness scorer, LLM analyzer, reporter
- **Delivery layers:** CLI (local), GitHub Action, Cloud Run service
- **Design constraint:** No demo-app-specific logic. Works with any repo producing JUnit XML from GitHub Actions.

## 4. Demo App Details

### API Endpoints
- `GET /tasks` — list tasks (optional `?status=pending|done` filter)
- `POST /tasks` — create task (title, description)
- `PATCH /tasks/:id` — update task (title, description, status)
- `DELETE /tasks/:id` — delete task
- `GET /tasks/stats` — returns counts (total, pending, done, completion percentage)

### Frontend
Single page: task list with status badges, add task form, click to toggle done/pending, delete button, stats bar showing completion percentage.

### Database
Single `tasks` table: `id`, `title`, `description`, `status`, `created_at`, `updated_at`. SQLite file-based for tests, in-memory option for unit tests.

### Test Layers

| Layer | Runner | Tests | JUnit Output |
|---|---|---|---|
| Unit | Vitest | Pure functions (validation, formatting, stats) | `junit-unit.xml` |
| Integration | Vitest | Service layer + real SQLite DB | `junit-integration.xml` |
| API | Vitest + Supertest | HTTP endpoints against test server | `junit-api.xml` |
| E2E | Playwright | Browser interactions against running app | `junit-e2e.xml` |

## 5. Planted Test Scenarios

### Flaky Tests (should be quarantined) — 10 scenarios

| # | Category | Layer | Implementation |
|---|---|---|---|
| 1 | Async / race condition | Integration | Service method fires async cache update, test asserts before completion. Missing `await` makes it pass ~80% of the time. |
| 2 | Test-order dependency | Unit | `formatTaskList()` test relies on module-level array mutated by a previous test. Passes in sequence, fails in isolation or shuffled. |
| 3 | External dependency | API | Test hits a real external endpoint (webhook notification URL) that occasionally times out. |
| 4 | Resource contention | Integration | Two tests write to the same temp SQLite file in parallel. One occasionally gets `SQLITE_BUSY`. |
| 5 | Time-sensitive | Unit | `isOverdue()` uses `Date.now()` internally. Test creates task "due in 1 second" — passes when fast, fails when slow. |
| 6 | Randomness / unseeded data | Unit | Input validation test uses `faker` to generate titles. Occasionally generates string hitting max-length edge case. |
| 7 | Concurrency / shared state in single test | Integration | Single test fires two parallel DB writes to same task (update title + update status). Occasionally one overwrites the other. |
| 8 | Floating-point precision | Unit | `getCompletionPercentage()` returns `(done/total)*100`. Test asserts `toBe(33.33)` — occasionally gets `33.330000000000005`. |
| 9 | Element not always present | E2E | Playwright checks for "No tasks yet" empty state that renders after async check. Times out when slow. |
| 10 | Click before render | E2E | Playwright clicks "Add Task" submit before form JS hydration finishes. Intermittent on CI. |

### Real Failures (must NOT quarantine) — 4 scenarios

| # | Category | Layer | Implementation |
|---|---|---|---|
| 11 | Genuine bug | Unit | `filterTasks({status: 'done'})` has wrong comparison operator. Fails every run. |
| 12 | Stale test after code change | API | API returns `completedAt` but test asserts on old `finishedAt` field. Fails every run. |
| 13 | Consistent failure at specific commit | Integration | Service method refactored, now throws on null input instead of returning empty array. Fails consistently from that commit. |
| 14 | Dependency/version break | Unit | Utility uses helper whose behavior changed in version bump (e.g., truncate default length). Fails every run. |

### Healthy Tests
~15-20 tests that always pass across all layers. The majority of the suite. Agent should correctly ignore these.

## 6. Agent Architecture

```
src/
  parser/         — JUnit XML -> structured test results
  scorer/         — Deterministic flakiness scoring
  analyzer/       — LLM-powered root cause analysis
  reporter/       — Formats output (PR comments, CLI, JSON)
```

### Parser
Reads JUnit XML files, outputs normalized structure:
```typescript
interface TestResult {
  testName: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  failureMessage?: string;
  stackTrace?: string;
  retryIndex?: number;  // 0 = first run, 1 = first retry, etc.
}
```
Handles multiple XML files (one per test layer). Extracts retry/rerun results.

### Scorer
Deterministic brain. No LLM. Takes parsed results and computes:

- **`same_sha_divergence`** — did this test pass AND fail at the same commit? (strongest flaky signal)
- **`failure_rate`** — what % of recent runs failed? (requires history, phase 5+)
- **`code_change_correlation`** — did failure start after a commit that touched relevant files? (requires history, phase 5+)
- **`flakiness_score`** — composite 0-100
- **`verdict`** — `flaky | real_break | inconclusive`

**Critical guardrail:** If a test fails consistently after a commit that changed relevant code, it's a `real_break` regardless of other signals.

**How scoring works without history (phases 2-5):**
Relies purely on retry results within a single CI run. Test runners (Vitest `--retry 2`, Playwright `retries: 2`) re-run failed tests at the same SHA. JUnit XML records all attempts.
- Failed then passed on retry → `flaky`
- Failed all retries → `inconclusive` (not enough data without history to distinguish a stubborn flake from a real break)

**How scoring improves with history (phase 5+):**
Firestore stores every test result. Scorer gains cross-SHA pattern analysis and code-change correlation.

### Analyzer
LLM-agnostic interface:
```typescript
interface FailureContext {
  testName: string;
  failureMessage: string;
  stackTrace: string;
  testSourceCode?: string;
  relevantDiff?: string;
}

interface Analysis {
  rootCauseCategory: string;
  explanation: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

function analyzeFailure(context: FailureContext): Promise<Analysis>;
```
Swap LLM providers by changing config. Start with Claude API.

### Reporter
Takes scorer output + analyzer output, formats as:
- CLI text (local use)
- Markdown PR comment (GitHub Action)
- JSON (API/webhook consumption)

## 7. Quarantine Mechanism

**Simple, framework-agnostic approach:** A `.flaky-quarantine.json` file in the repo root.

```json
{
  "quarantined": [
    {
      "testName": "should update cache after task creation",
      "suite": "integration/taskService",
      "quarantinedAt": "2026-06-15T10:00:00Z",
      "reason": "Race condition in async cache update — passes ~80% of runs",
      "quarantinedBy": "flaky-triager"
    }
  ]
}
```

CI reads this file. Quarantined test failures are reported but marked as non-blocking (exit code 0 even if they fail). The agent opens a PR to add/remove entries — human approves/merges.

## 8. Autonomy Ladder

1. **Agent proposes, human confirms** — agent posts PR comment with "Quarantine" recommendation. Human clicks to create PR. (Phase 8)
2. **Auto-quarantine with notification** — agent opens quarantine PR automatically for high-confidence flakes (score > 90). Human still merges. (Phase 9)
3. **Auto-un-quarantine** — when a quarantined test passes consistently for N runs, agent opens PR to remove it. (Phase 9)

## 9. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript | Both repos |
| LLM | Claude API (swappable) | LLM-agnostic interface, any model works |
| Test history store | Firestore | Per-test run history, added in phase 7 |
| CI integration | GitHub Action | Where the agent runs, phases 6-8 |
| Service host | Cloud Run | Webhook-driven, phase 9 |
| Demo app DB | SQLite (better-sqlite3) | Zero setup, ships with the app |
| Demo app frontend | React | Minimal single-page UI |
| Demo app API | Express | CRUD REST API |

## 10. Phased Build Plan

Each phase is completable in a single 2-3 hour sitting. Phases are independent enough to pick up weeks later.

### Phase 1: Demo repo — App scaffold + CI
- Scaffold Express API + SQLite + React frontend
- Set up Vitest (unit, integration, API) + Playwright (E2E)
- Write ~15-20 healthy passing tests across all layers
- Configure GitHub Actions to run tests and upload JUnit XML artifacts
- Verify CI goes green

### Phase 2: Demo repo — Plant flaky + real failure tests
- Add the 10 flaky test scenarios across layers
- Add the 4 real failure test scenarios
- Configure Vitest retries (`--retry 2`) and Playwright retries
- Verify JUnit XML captures retry results
- Run CI multiple times to confirm flaky tests actually flake

### Phase 3: Agent — JUnit XML parser
- Parse standard JUnit XML schema
- Handle multiple XML files (one per layer)
- Extract retry/rerun results from XML
- Unit tests for the parser
- CLI: `npx flaky-triager parse ./results/` prints structured output

### Phase 4: Agent — Flakiness scorer
- Same-SHA divergence detection (retry pass/fail at same commit)
- Failure consistency check (failed all retries = likely real)
- Composite flakiness score (0-100)
- Verdict: `flaky | real_break | inconclusive`
- Unit tests: known patterns in, correct verdicts out
- CLI: `npx flaky-triager score ./results/` prints verdicts

### Phase 5: Agent — LLM analyzer
- LLM-agnostic interface
- Context assembly: failure message, stack trace, test source, relevant diff
- Prompt engineering for root-cause categorization + explanation
- Start with Claude API
- CLI: `npx flaky-triager analyze ./results/` prints explanations

### Phase 6: Agent — GitHub Action (Loop A: Explain)
- Package parser + scorer + analyzer as a GitHub Action
- Trigger on `workflow_run` completed
- Download JUnit XML artifacts from triggering workflow
- Run parser -> scorer -> analyzer pipeline
- Post formatted PR comment: verdict + explanation per failure
- Test against demo repo

### Phase 7: Agent — Firestore history + improved scoring
- Firestore schema: `{testName, suite, sha, branch, status, duration, timestamp}`
- Store every test result on each CI run
- Enhanced scorer: cross-SHA patterns, code-change correlation via GitHub diff API
- Flakiness trend tracking
- CLI: `npx flaky-triager history <test-name>` shows run history

### Phase 8: Agent — GitHub Action (Loop B: Quarantine)
- On detecting flaky test, post comment with quarantine recommendation
- Agent opens PR adding test to `.flaky-quarantine.json`
- CI reads quarantine file, marks quarantined failures as non-blocking
- Auto-un-quarantine: agent opens PR to remove test when stable for N runs
- Human approves/merges — agent never force-merges

### Phase 9: Agent — Cloud Run service
- Cloud Run HTTP service receiving GitHub webhook events
- Same pipeline: parse -> score -> analyze -> comment
- Multi-repo support, persistent state
- Configurable auto-quarantine for high-confidence flakes

---

## Changelog
- 2026-05-25: Initial design spec created
