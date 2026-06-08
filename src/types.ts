export interface TestResult {
  testName: string;
  suite: string;
  className: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  duration: number;
  failureMessage?: string;
  stackTrace?: string;
  retryIndex: number;
  sourceFile?: string;
}

export interface TestRunSummary {
  file: string;
  timestamp?: string;
  totalTests: number;
  failures: number;
  errors: number;
  skipped: number;
  duration: number;
  results: TestResult[];
}

export type Verdict = 'flaky' | 'real_break' | 'inconclusive' | 'passing';

export interface ScoredResult {
  testName: string;
  suite: string;
  verdict: Verdict;
  flakinessScore: number;
  sameSHADivergence: boolean;
  totalRuns: number;
  failures: number;
  passes: number;
  failureMessage?: string;
  stackTrace?: string;
  /** True when any attempt this run was demoted to skipped (e.g. by filter-junit). */
  wasSkipped?: boolean;
}

export interface FailureContext {
  testName: string;
  suite: string;
  failureMessage: string;
  stackTrace: string;
  testSourceCode?: string;
  relevantDiff?: string;
}

export interface Analysis {
  rootCauseCategory: string;
  explanation: string;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TriageReport {
  timestamp: string;
  sha?: string;
  results: Array<ScoredResult & { analysis?: Analysis }>;
  summary: {
    total: number;
    flaky: number;
    realBreaks: number;
    inconclusive: number;
    passing: number;
  };
}
