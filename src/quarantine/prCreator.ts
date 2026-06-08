import type { getOctokit } from '@actions/github';
import {
  addEntries,
  emptyQuarantine,
  removeEntries,
  type Quarantine,
  type QuarantineEntry,
} from './file.js';
import {
  formatQuarantinePrBody,
  formatUnQuarantinePrBody,
  quarantinePrTitle,
  unQuarantinePrTitle,
  QUARANTINE_BRANCH,
  QUARANTINE_FILE_PATH,
  QUARANTINE_PR_MARKER,
  UNQUARANTINE_BRANCH,
  UNQUARANTINE_PR_MARKER,
} from './prFormatter.js';

type Octokit = ReturnType<typeof getOctokit>;

export interface OpenQuarantinePrOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  candidates: QuarantineEntry[];
  sourcePrNumber?: number;
  sourcePrUrl?: string;
}

export interface QuarantinePrResult {
  number: number;
  htmlUrl: string;
  created: boolean;
}

async function getDefaultBranch(octokit: Octokit, owner: string, repo: string): Promise<string> {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return data.default_branch;
}

async function getBranchHeadSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const { data } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  return data.object.sha;
}

async function getCurrentQuarantineFromBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<Quarantine> {
  try {
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

async function findOpenPrByBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; htmlUrl: string } | null> {
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 1,
  });
  if (data.length === 0) return null;
  return { number: data[0].number, htmlUrl: data[0].html_url };
}

async function upsertBranchWithFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  baseSha: string,
  fileContent: string,
  message: string,
): Promise<string> {
  // Build a single fresh commit on top of the default branch so the quarantine
  // branch is always exactly one commit ahead — no accumulating churn from
  // earlier runs.
  const blob = await octokit.rest.git.createBlob({
    owner,
    repo,
    content: fileContent,
    encoding: 'utf-8',
  });
  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseSha,
    tree: [
      {
        path: QUARANTINE_FILE_PATH,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha,
      },
    ],
  });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.data.sha,
    parents: [baseSha],
  });

  try {
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.data.sha,
      force: true,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 422) {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commit.data.sha,
      });
    } else {
      throw err;
    }
  }

  return commit.data.sha;
}

export async function openOrUpdateQuarantinePr(
  opts: OpenQuarantinePrOptions,
): Promise<QuarantinePrResult | null> {
  const { octokit, owner, repo, candidates, sourcePrNumber, sourcePrUrl } = opts;
  if (candidates.length === 0) return null;

  const defaultBranch = await getDefaultBranch(octokit, owner, repo);
  const defaultSha = await getBranchHeadSha(octokit, owner, repo, defaultBranch);

  const current = await getCurrentQuarantineFromBranch(octokit, owner, repo, defaultBranch);
  const updated = addEntries(current, candidates);
  const fileContent = JSON.stringify(updated, null, 2) + '\n';

  await upsertBranchWithFile(
    octokit,
    owner,
    repo,
    QUARANTINE_BRANCH,
    defaultSha,
    fileContent,
    `chore: quarantine ${candidates.length} flaky test(s)`,
  );

  const body = formatQuarantinePrBody({ candidates, sourcePrNumber, sourcePrUrl });
  const title = quarantinePrTitle(updated.entries.length);

  const existing = await findOpenPrByBranch(octokit, owner, repo, QUARANTINE_BRANCH);
  if (existing) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: existing.number,
      title,
      body,
    });
    return { number: existing.number, htmlUrl: existing.htmlUrl, created: false };
  }

  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    head: QUARANTINE_BRANCH,
    base: defaultBranch,
    title,
    body,
  });
  return { number: data.number, htmlUrl: data.html_url, created: true };
}

export { QUARANTINE_PR_MARKER, QUARANTINE_BRANCH, QUARANTINE_FILE_PATH };

export interface OpenUnQuarantinePrOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  removals: Array<{ suite: string; testName: string }>;
  minPasses: number;
  sourcePrNumber?: number;
  sourcePrUrl?: string;
}

export async function openOrUpdateUnQuarantinePr(
  opts: OpenUnQuarantinePrOptions,
): Promise<QuarantinePrResult | null> {
  const { octokit, owner, repo, removals, minPasses, sourcePrNumber, sourcePrUrl } = opts;
  if (removals.length === 0) return null;

  const defaultBranch = await getDefaultBranch(octokit, owner, repo);
  const defaultSha = await getBranchHeadSha(octokit, owner, repo, defaultBranch);

  const current = await getCurrentQuarantineFromBranch(octokit, owner, repo, defaultBranch);
  // Capture full entries (with original score/reason) before we strip them so
  // the PR body can show what's being removed.
  const removedEntries = current.entries.filter((e) =>
    removals.some((r) => r.suite === e.suite && r.testName === e.testName),
  );
  if (removedEntries.length === 0) return null;
  const updated = removeEntries(current, removals);
  const fileContent = JSON.stringify(updated, null, 2) + '\n';

  await upsertBranchWithFile(
    octokit,
    owner,
    repo,
    UNQUARANTINE_BRANCH,
    defaultSha,
    fileContent,
    `chore: un-quarantine ${removals.length} test(s) after ${minPasses}+ consecutive passes`,
  );

  const body = formatUnQuarantinePrBody({
    removals: removedEntries,
    minPasses,
    sourcePrNumber,
    sourcePrUrl,
  });
  const title = unQuarantinePrTitle(removedEntries.length);

  const existing = await findOpenPrByBranch(octokit, owner, repo, UNQUARANTINE_BRANCH);
  if (existing) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: existing.number,
      title,
      body,
    });
    return { number: existing.number, htmlUrl: existing.htmlUrl, created: false };
  }

  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    head: UNQUARANTINE_BRANCH,
    base: defaultBranch,
    title,
    body,
  });
  return { number: data.number, htmlUrl: data.html_url, created: true };
}

export { UNQUARANTINE_PR_MARKER, UNQUARANTINE_BRANCH };
