export {
  readQuarantineFile,
  writeQuarantineFile,
  isQuarantined,
  addEntries,
  removeEntries,
  emptyQuarantine,
} from './file.js';
export type { Quarantine, QuarantineEntry } from './file.js';
export { recommendQuarantine, RECOMMEND_MIN_SCORE } from './recommender.js';
