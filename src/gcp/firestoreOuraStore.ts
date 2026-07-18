import { Firestore, Timestamp } from '@google-cloud/firestore';
import { OuraExportState, OuraExportStateStore } from '../services/ouraDailyExportWorkflow';
import {
  PlaylistGenerationState,
  PlaylistGenerationStateStore,
  OuraPlaylistInput,
} from '../services/playlistGenerationWorkflow';

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

export class FirestorePlaylistGenerationStateStore implements PlaylistGenerationStateStore {
  constructor(
    private readonly firestore = new Firestore(),
    private readonly collectionName = process.env.GCP_PLAYLIST_STATE_COLLECTION || 'playlistGenerationState',
    private readonly leaseSeconds = 600
  ) {}

  async get(date: string): Promise<PlaylistGenerationState | undefined> {
    const snapshot = await this.firestore.collection(this.collectionName).doc(date).get();
    return snapshot.exists ? snapshot.data() as PlaylistGenerationState : undefined;
  }

  async claim(date: string, fingerprint: string, ouraInput: OuraPlaylistInput, force = false): Promise<'claimed' | 'duplicate' | 'busy'> {
    const reference = this.firestore.collection(this.collectionName).doc(date);
    return this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists ? snapshot.data() as PlaylistGenerationState : undefined;
      const now = Date.now();
      const leaseActive = existing?.status === 'processing'
        && Boolean(existing.leaseExpiresAt)
        && Date.parse(existing.leaseExpiresAt!) > now;

      if (!force && existing?.status === 'generated' && existing.fingerprint === fingerprint) return 'duplicate';
      if (leaseActive) return 'busy';

      transaction.set(reference, {
        date,
        status: 'processing',
        fingerprint,
        ouraInput,
        attempts: (existing?.attempts || 0) + 1,
        updatedAt: new Date(now).toISOString(),
        leaseExpiresAt: new Date(now + this.leaseSeconds * 1000).toISOString(),
        lastError: null,
      }, { merge: true });
      return 'claimed';
    });
  }

  async complete(date: string, fingerprint: string, spotifySnapshotId?: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(date).set({
      status: 'generated',
      fingerprint,
      spotifySnapshotId: spotifySnapshotId || null,
      updatedAt: new Date().toISOString(),
      leaseExpiresAt: null,
      lastError: null,
    }, { merge: true });
  }

  async fail(date: string, fingerprint: string, error: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(date).set({
      status: 'failed',
      fingerprint,
      updatedAt: new Date().toISOString(),
      leaseExpiresAt: null,
      lastError: error.slice(0, 1000),
    }, { merge: true });
  }
}
