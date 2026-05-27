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

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const anthropicApiKey = core.getInput('anthropic-api-key', { required: true });
    const artifactName = core.getInput('artifact-name') || 'test-results';
    const resultsDirInput = core.getInput('results-dir');

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

    const scored = scoreTestResults(allResults);
    const provider = createClaudeProvider();
    const analyzed = await analyzeFailures(scored, provider);
    const markdown = formatReport(analyzed, 'markdown');
    const summary = summarize(analyzed);

    core.setOutput('flaky-count', summary.flaky);
    core.setOutput('break-count', summary.realBreaks);
    core.setOutput('inconclusive-count', summary.inconclusive);
    core.setOutput('report-markdown', markdown);

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
