import { FirestoreHistoryStore, type FirestoreLike } from './firestore.js';
import type { HistoryStore } from './types.js';

export interface InitLogger {
  info(msg: string): void;
  warning(msg: string): void;
}

export interface CreateHistoryStoreOptions {
  credentialsJson?: string;
  projectId?: string;
  log?: InitLogger;
}

const SILENT_LOG: InitLogger = { info: () => {}, warning: () => {} };

export async function createHistoryStore(
  opts: CreateHistoryStoreOptions,
): Promise<HistoryStore | undefined> {
  const log = opts.log ?? SILENT_LOG;
  const raw = opts.credentialsJson?.trim();
  if (!raw) {
    log.info('No Firestore credentials provided — running without history.');
    return undefined;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warning(`firestore-credentials is not valid JSON: ${msg}. Running without history.`);
    return undefined;
  }

  try {
    const admin = await import('firebase-admin');
    type ServiceAccountLike = Parameters<typeof admin.credential.cert>[0];
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(parsed as ServiceAccountLike),
        projectId: opts.projectId || (parsed.project_id as string | undefined),
      });
    }
    const db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return new FirestoreHistoryStore({ firestore: db as unknown as FirestoreLike });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warning(`Failed to initialise Firestore: ${msg}. Running without history.`);
    return undefined;
  }
}
