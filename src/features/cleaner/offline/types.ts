export type UploadPhotoType = "before" | "after" | "incident";

export type PendingUploadStatus = "pending" | "syncing" | "failed";

export type PendingUpload = {
  id: string;
  jobId: string;
  roomName: string;
  photoType: UploadPhotoType;
  fileName: string;
  mimeType: string;
  fileDataUrl: string;
  createdAt: number;
  attempts: number;
  status: PendingUploadStatus;
  lastError?: string;
};

export type DraftIncident = {
  id: string;
  title: string;
  description?: string;
  roomName?: string;
  severity?: "low" | "medium" | "high" | "critical";
  localPhotoIds: string[];
};

export type DraftProgress = {
  jobId: string;
  phase: "before_photos" | "cleaning" | "after_photos" | "incidents" | "review";
  checklistDoneRooms: string[];
  skippedRooms: Array<{ roomName: string; reason: string }>;
  qaMode: "standard" | "quick";
  quickMinimumBefore: number;
  quickMinimumAfter: number;
  requiredRooms: string[];
  completionNotes: string;
  guestReady: boolean;
  incidents: DraftIncident[];
  updatedAt: number;
};

export type SyncState = {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  canSubmit: boolean;
  lastError?: string;
};
