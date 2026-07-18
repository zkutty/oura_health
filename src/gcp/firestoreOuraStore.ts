import { Firestore, Timestamp } from '@google-cloud/firestore';
import { OuraExportState, OuraExportStateStore } from '../services/ouraDailyExportWorkflow';

export class FirestoreOuraExportStateStore implements OuraExportStateStore {
  constructor(
    private readonly firestore = new Firestore(),
    private readonly collectionName = process.env.GCP_OURA_EXPORT_COLLECTION || 'ouraExportState'
  ) {}

  async get(date: string): Promise<OuraExportState | undefined> {
    const snapshot = await this.firestore.collection(this.collectionName).doc(date).get();
    if (!snapshot.exists) return undefined;
    return snapshot.data() as OuraExportState;
  }

  async save(state: Omit<OuraExportState, 'updatedAt'>): Promise<OuraExportState> {
    const saved: OuraExportState = { ...state, updatedAt: new Date().toISOString() };
    const firestoreDocument = Object.fromEntries(
      Object.entries(saved).filter(([, value]) => value !== undefined)
    );
    await this.firestore.collection(this.collectionName).doc(state.date).set(firestoreDocument, { merge: true });
    return saved;
  }
}

export class FirestoreWebhookReplayStore {
  constructor(
    private readonly firestore = new Firestore(),
    private readonly collectionName = process.env.GCP_OURA_REPLAY_COLLECTION || 'ouraWebhookReplay'
  ) {}

  async reserve(eventId: string, ttlSeconds = 600): Promise<boolean> {
    const reference = this.firestore.collection(this.collectionName).doc(eventId);
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + ttlSeconds * 1000);

    return this.firestore.runTransaction(async transaction => {
      const existing = await transaction.get(reference);
      const existingExpiry = existing.data()?.expiresAt as Timestamp | undefined;
      if (existing.exists && existingExpiry && existingExpiry.toMillis() > now.toMillis()) {
        return false;
      }
      transaction.set(reference, { createdAt: now, expiresAt });
      return true;
    });
  }

  async release(eventId: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(eventId).delete();
  }
}
