/** The caller must supply the user ID from authenticated server context. */
export interface PersonalExport {
  readonly schemaVersion: 1;
  readonly account: { readonly id: string; readonly status: string; readonly createdAt: Date };
  readonly identity: readonly unknown[];
  readonly consent: readonly unknown[];
  readonly profiles: readonly unknown[];
  readonly profileFacts: readonly unknown[];
  readonly matchPolicies: readonly unknown[];
  readonly photos: readonly unknown[];
  readonly visualFeatures: readonly unknown[];
  readonly invitations: readonly unknown[];
  readonly feedback: readonly unknown[];
  readonly auditHistory: readonly unknown[];
  readonly transactionRecords: {
    readonly dates: readonly unknown[];
    readonly checkins: readonly unknown[];
    readonly paymentOrders: readonly unknown[];
    readonly refunds: readonly unknown[];
  };
}

export type DeletionState = "requested" | "purging" | "failed" | "completed";

export interface DeletionReceipt {
  readonly id: string;
  readonly status: DeletionState;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
  readonly attempts: number;
  readonly failureStage: "media" | "database" | null;
  readonly retainedSummary: Readonly<Record<string, number>>;
}

export interface PrivacyRepository {
  exportForUser(userId: string): Promise<PersonalExport | null>;
  requestDeletion(userId: string): Promise<DeletionReceipt>;
  deletionStatus(userId: string): Promise<DeletionReceipt | null>;
  claimDeletion(userId: string): Promise<boolean>;
  pendingDeletionUserIds(limit: number): Promise<readonly string[]>;
  photoIdsForDeletion(userId: string): Promise<readonly string[]>;
  finalizeDeletion(userId: string): Promise<DeletionReceipt>;
  failDeletion(userId: string, stage: "media" | "database"): Promise<void>;
}

export class PrivacyError extends Error {
  constructor(readonly code: "not_found" | "deletion_failed") {
    super(code);
  }
}

export interface PrivacyService {
  exportForSelf(authenticatedUserId: string): Promise<PersonalExport>;
  requestDeletionForSelf(authenticatedUserId: string): Promise<DeletionReceipt>;
  deletionStatusForSelf(authenticatedUserId: string): Promise<DeletionReceipt | null>;
  /** Called by a trusted worker; repeated calls resume an interrupted purge. */
  processDeletion(userId: string): Promise<DeletionReceipt>;
}

export function createPrivacyService(deps: {
  repository: PrivacyRepository;
  media: { remove(ownerUserId: string, assetId: string): Promise<void> };
}): PrivacyService {
  return {
    async exportForSelf(authenticatedUserId) {
      const data = await deps.repository.exportForUser(authenticatedUserId);
      if (data === null) throw new PrivacyError("not_found");
      return data;
    },
    requestDeletionForSelf(authenticatedUserId) {
      return deps.repository.requestDeletion(authenticatedUserId);
    },
    deletionStatusForSelf(authenticatedUserId) {
      return deps.repository.deletionStatus(authenticatedUserId);
    },
    async processDeletion(userId) {
      if (!(await deps.repository.claimDeletion(userId))) {
        const current = await deps.repository.deletionStatus(userId);
        if (current === null) throw new PrivacyError("not_found");
        return current;
      }
      let stage: "media" | "database" = "media";
      try {
        for (const assetId of await deps.repository.photoIdsForDeletion(userId)) {
          await deps.media.remove(userId, assetId);
        }
        stage = "database";
        return await deps.repository.finalizeDeletion(userId);
      } catch {
        await deps.repository.failDeletion(userId, stage);
        throw new PrivacyError("deletion_failed");
      }
    },
  };
}
