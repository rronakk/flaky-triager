import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { parseJUnitXMLFiles } from './parser/index.js';
import { scoreTestResults } from './scorer/index.js';
import { analyzeFailures } from './analyzer/index.js';
import { createClaudeProvider } from './analyzer/providers/claude.js';
import { formatReport, REPORT_MARKER, summarize } from './reporter/index.js';
import {
  createHistoryStore,
  recordsFromScored,
  testKeyFor,
  type HistoryStore,
  type TestRunRecord,
} from './history/index.js';
import { recommendQuarantine } from './quarantine/recommender.js';
import { openOrUpdateQuarantinePr } from './quarantine/prCreator.js';
import { emptyQuarantine, type Quarantine } from './quarantine/file.js';
import { QUARANTINE_FILE_PATH } from './quarantine/prFormatter.js';

type Octokit = ReturnType<typeof github.getOctokit>;

async function downloadArtifactToDir(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
  artifactName: string,
): Promise<string> {
  const artifacts = await octokit.rest.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: runId,
  });
  const artifact = artifacts.data.artifacts.find((a) => a.name === artifactName);
  if (!artifact) {
    throw new Error(
      `Artifact "${artifactName}" not found in workflow run ${runId}. ` +
        `Available: ${artifacts.data.artifacts.map((a) => a.name).join(', ') || 'none'}`,
    );
  }

  const download = await octokit.rest.actions.downloadArtifact({
    owner,
    repo,
    artifact_id: artifact.id,
    archive_format: 'zip',
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-triager-'));
  const zipPath = path.join(tmpDir, 'artifact.zip');
  fs.writeFileSync(zipPath, Buffer.from(download.data as ArrayBuffer));

  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);
  new AdmZip(zipPath).extractAllTo(extractDir, true);
  return extractDir;
}

async function upsertPrComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const existing = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const ours = existing.find((c) => c.body?.includes(REPORT_MARKER));
  if (ours) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: ours.id, body });
    core.info(`Updated existing flaky-triager comment ${ours.id} on PR #${prNumber}.`);
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    core.info(`Created new flaky-triager comment on PR #${prNumber}.`);
  }
}

function resolvePrNumber(): number | undefined {
  const { context } = github;
  const fromWorkflowRun = context.payload.workflow_run?.pull_requests?.[0]?.number;
  if (typeof fromWorkflowRun === 'number') return fromWorkflowRun;
  const fromPull = context.payload.pull_request?.number;
  if (typeof fromPull === 'number') return fromPull;
  return undefined;
}

function resolveShaAndBranch(): { sha: string; branch: string } {
  const { context } = github;
  const pr = context.payload.pull_request;
  if (pr?.head?.sha && pr.head.ref) {
    return { sha: pr.head.sha, branch: pr.head.ref };
  }
  const wr = context.payload.workflow_run;
  if (wr?.head_sha && wr?.head_branch) {
    return { sha: wr.head_sha, branch: wr.head_branch };
  }
  const branch = context.ref?.replace(/^refs\/heads\//, '') || 'unknown';
  return { sha: context.sha || 'unknown', branch };
}

async function loadQuarantineFromDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Quarantine> {
  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const branch = repoData.default_branch;
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: QUARANTINE_FILE_PATH,
      ref: branch,
    });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
      return emptyQuarantine();
    }
    const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as Quarantine;
    if (!Array.isArray(parsed.entries)) return emptyQuarantine();
    return { version: 1, entries: parsed.entries };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return emptyQuarantine();
    throw err;
  }
}

async function loadHistoryForKeys(
  store: HistoryStore,
  keys: string[],
  limit: number,
): Promise<Map<string, TestRunRecord[]>> {
  const map = new Map<string, TestRunRecord[]>();
  const results = await Promise.all(
    keys.map(async (k) => ({ key: k, records: await store.getHistory(k, limit) })),
  );
  for (const { key, records } of results) {
    if (records.length > 0) map.set(key, records);
  }
  return map;
}

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const anthropicApiKey = core.getInput('anthropic-api-key', { required: true });
    const artifactName = core.getInput('artifact-name') || 'test-results';
    const resultsDirInput = core.getInput('results-dir');
    const firestoreCredentials = core.getInput('firestore-credentials');
    const firestoreProjectId = core.getInput('firestore-project-id');
    const firestoreDatabaseId = core.getInput('firestore-database-id');
    const historyLimit = Number(core.getInput('history-limit') || '10');

    process.env.ANTHROPIC_API_KEY = anthropicApiKey;

    const octokit = github.getOctokit(githubToken);
    const { context } = github;
    const { owner, repo } = context.repo;

    let resultsDir: string;
    if (resultsDirInput) {
      resultsDir = path.resolve(resultsDirInput);
      core.info(`Reading JUnit XML from local path: ${resultsDir}`);
    } else {
      const runId = context.payload.workflow_run?.id;
      if (typeof runId !== 'number') {
        throw new Error(
          'No workflow_run in payload and no results-dir input provided. ' +
            'Trigger this Action on workflow_run, or pass results-dir directly.',
        );
      }
      core.info(`Downloading artifact "${artifactName}" from run ${runId}…`);
      resultsDir = await downloadArtifactToDir(octokit, owner, repo, runId, artifactName);
    }

    const summaries = parseJUnitXMLFiles(resultsDir);
    const allResults = summaries.flatMap((s) => s.results);
    core.info(`Parsed ${summaries.length} XML files, ${allResults.length} test results.`);

    const historyStore = await createHistoryStore({
      credentialsJson: firestoreCredentials,
      projectId: firestoreProjectId || undefined,
      databaseId: firestoreDatabaseId || undefined,
      log: { info: core.info, warning: core.warning },
    });

    const rawScored = scoreTestResults(allResults);

    let scored = rawScored;
    if (historyStore) {
      const { sha, branch } = resolveShaAndBranch();
      const keys = rawScored.map((s) => testKeyFor(s.suite, s.testName));

      const history = await loadHistoryForKeys(historyStore, keys, historyLimit).catch((err) => {
        core.warning(`Failed to load history: ${err instanceof Error ? err.message : String(err)}`);
        return new Map<string, TestRunRecord[]>();
      });
      core.info(`Loaded history for ${history.size} of ${keys.length} tests.`);

      scored = scoreTestResults(allResults, history);

      await historyStore
        .saveResults(sha, branch, recordsFromScored(rawScored, { sha, branch }))
        .then(() => core.info(`Saved ${rawScored.length} run records to history.`))
        .catch((err) =>
          core.warning(`Failed to save history: ${err instanceof Error ? err.message : String(err)}`),
        );
    }

    const provider = createClaudeProvider();
    const analyzed = await analyzeFailures(scored, provider);
    const reportMarkdown = formatReport(analyzed, 'markdown');
    const summary = summarize(analyzed);

    let quarantineSection = '';
    let quarantinePrUrl: string | undefined;

    if (summary.flaky > 0) {
      try {
        const currentQuarantine = await loadQuarantineFromDefaultBranch(octokit, owner, repo);
        const candidates = recommendQuarantine(analyzed, currentQuarantine);
        if (candidates.length > 0) {
          core.info(`Recommending ${candidates.length} test(s) for quarantine.`);
          const prNumber = resolvePrNumber();
          const sourcePrUrl =
            prNumber !== undefined ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : undefined;
          const result = await openOrUpdateQuarantinePr({
            octokit,
            owner,
            repo,
            candidates,
            sourcePrNumber: prNumber,
            sourcePrUrl,
          });
          if (result) {
            quarantinePrUrl = result.htmlUrl;
            core.info(
              `${result.created ? 'Created' : 'Updated'} quarantine PR #${result.number}: ${result.htmlUrl}`,
            );
          }
          quarantineSection = [
            '',
            '## Quarantine recommendations',
            '',
            `${candidates.length} flaky test(s) recommended for quarantine.`,
            quarantinePrUrl ? `Review and merge: [quarantine PR](${quarantinePrUrl})` : '',
            '',
          ]
            .filter(Boolean)
            .join('\n');
        } else {
          core.info('No new quarantine candidates (all flaky tests already quarantined).');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        core.warning(`Quarantine flow failed: ${msg}`);
      }
    }

    const markdown = reportMarkdown + quarantineSection;

    core.setOutput('flaky-count', summary.flaky);
    core.setOutput('break-count', summary.realBreaks);
    core.setOutput('inconclusive-count', summary.inconclusive);
    core.setOutput('report-markdown', markdown);
    if (quarantinePrUrl) core.setOutput('quarantine-pr-url', quarantinePrUrl);

    core.info('--- Report ---');
    core.info(markdown);

    const prNumber = resolvePrNumber();
    if (prNumber === undefined) {
      core.warning('No associated PR found; skipping comment.');
      return;
    }
    await upsertPrComment(octokit, owner, repo, prNumber, markdown);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(msg);
  }
}

run();
