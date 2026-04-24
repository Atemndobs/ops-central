// Convex Schema for Cleaning Operations
// Shared by: opscentral-admin (web) + jna-cleaners-app (mobile)
// Deployment: usable-anaconda-394
// Created: 2026-03-24

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════════
// USERS & AUTH
// ═══════════════════════════════════════════════════════════════════════════════

const users = defineTable({
  clerkId: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  role: v.union(
    v.literal("cleaner"),
    v.literal("manager"),
    v.literal("property_ops"),
    v.literal("admin")
  ),
  pushToken: v.optional(v.string()),
  phone: v.optional(v.string()),
  preferredLocale: v.optional(v.union(v.literal("en"), v.literal("es"))),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_clerk_id", ["clerkId"])
  .index("by_email", ["email"])
  .index("by_role", ["role"]);

const userRoles = defineTable({
  userId: v.id("users"),
  role: v.string(),
  grantedBy: v.optional(v.id("users")),
  grantedAt: v.number(),
  revokedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_active", ["userId", "revokedAt"]);

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANING COMPANIES
// ═══════════════════════════════════════════════════════════════════════════════

const cleaningCompanies = defineTable({
  name: v.string(),
  ownerId: v.optional(v.id("users")),
  contactEmail: v.optional(v.string()),
  contactPhone: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
  // Service city — a cleaning company only covers one city (e.g. "Dallas",
  // "Austin", "Houston"). Used to filter the company dropdown on the property
  // assignment table so admins only see companies in the property's city.
  city: v.optional(v.string()),
  isActive: v.boolean(),
  settings: v.optional(v.object({
    autoAssign: v.optional(v.boolean()),
    notificationPreferences: v.optional(v.any()),
  })),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_owner", ["ownerId"])
  .index("by_active", ["isActive"]);

const companyMembers = defineTable({
  companyId: v.id("cleaningCompanies"),
  userId: v.id("users"),
  role: v.union(
    v.literal("cleaner"),
    v.literal("manager"),
    v.literal("owner")
  ),
  isActive: v.boolean(),
  joinedAt: v.number(),
  leftAt: v.optional(v.number()),
})
  .index("by_company", ["companyId"])
  .index("by_user", ["userId"])
  .index("by_company_role", ["companyId", "role"]);

const companyProperties = defineTable({
  companyId: v.id("cleaningCompanies"),
  propertyId: v.id("properties"),
  assignedAt: v.number(),
  assignedBy: v.optional(v.id("users")),
  isActive: v.optional(v.boolean()),
  unassignedAt: v.optional(v.number()),
  unassignedBy: v.optional(v.id("users")),
  unassignedReason: v.optional(v.string()),
})
  .index("by_company", ["companyId"])
  .index("by_property", ["propertyId"])
  .index("by_property_and_is_active", ["propertyId", "isActive"])
  .index("by_company_and_is_active", ["companyId", "isActive"]);

// ═══════════════════════════════════════════════════════════════════════════════
// PROPERTIES
// ═══════════════════════════════════════════════════════════════════════════════

const properties = defineTable({
  name: v.string(),
  hospitableId: v.optional(v.string()),

  // Location
  address: v.string(),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zipCode: v.optional(v.string()),
  country: v.optional(v.string()),
  timezone: v.optional(v.string()),

  // Details
  bedrooms: v.optional(v.number()),
  bathrooms: v.optional(v.number()),
  squareFeet: v.optional(v.number()),
  propertyType: v.optional(v.string()),

  // Room list (synced from Hospitable or manually configured)
  rooms: v.optional(v.array(v.object({
    name: v.string(),
    type: v.string(),
  }))),

  // Links
  airbnbUrl: v.optional(v.string()),
  vrboUrl: v.optional(v.string()),
  directBookingUrl: v.optional(v.string()),

  // Media
  imageUrl: v.optional(v.string()),

  // Access / field-ops context (shown to cleaners on the job detail)
  accessNotes: v.optional(v.string()),
  keyLocation: v.optional(v.string()),
  parkingNotes: v.optional(v.string()),
  urgentNotes: v.optional(v.string()),

  // Extensible property instructions — admin-managed, shown to cleaners.
  // Categories are a closed list so the cleaner UI can render a matching icon.
  instructions: v.optional(
    v.array(
      v.object({
        id: v.string(),
        category: v.union(
          v.literal("access"),
          v.literal("trash"),
          v.literal("lawn"),
          v.literal("hot_tub"),
          v.literal("pool"),
          v.literal("parking"),
          v.literal("wifi"),
          v.literal("checkout"),
          v.literal("pets"),
          v.literal("other"),
        ),
        title: v.string(),
        body: v.string(),
        // Source language of the human-authored title/body (defaults to "en"
        // for legacy rows). Auto-translations live in `translations`.
        sourceLang: v.optional(v.union(v.literal("en"), v.literal("es"))),
        translations: v.optional(
          v.object({
            en: v.optional(
              v.object({ title: v.string(), body: v.string() }),
            ),
            es: v.optional(
              v.object({ title: v.string(), body: v.string() }),
            ),
          }),
        ),
        updatedAt: v.number(),
      }),
    ),
  ),

  // Config
  isActive: v.boolean(),
  currency: v.optional(v.string()),

  // Amenities
  amenities: v.optional(v.array(v.string())),

  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_hospitable", ["hospitableId"])
  .index("by_active", ["isActive"])
  .index("by_city", ["city"])
  .searchIndex("search_name", { searchField: "name" });

const propertyImages = defineTable({
  propertyId: v.id("properties"),
  storageId: v.optional(v.id("_storage")),
  imageUrl: v.optional(v.string()),
  caption: v.optional(v.string()),
  sortOrder: v.number(),
  isPrimary: v.boolean(),
  createdAt: v.number(),
})
  .index("by_property", ["propertyId"])
  .index("by_property_order", ["propertyId", "sortOrder"]);

const propertyTags = defineTable({
  propertyId: v.id("properties"),
  tagName: v.string(),
  createdAt: v.number(),
})
  .index("by_property", ["propertyId"])
  .index("by_tag", ["tagName"]);

const propertyOpsAssignments = defineTable({
  propertyId: v.id("properties"),
  userId: v.id("users"),
  role: v.string(),
  assignedAt: v.number(),
  assignedBy: v.optional(v.id("users")),
})
  .index("by_property", ["propertyId"])
  .index("by_user", ["userId"]);

// ═══════════════════════════════════════════════════════════════════════════════
// STAYS (RESERVATIONS)
// ═══════════════════════════════════════════════════════════════════════════════

const stays = defineTable({
  propertyId: v.id("properties"),
  hospitableId: v.optional(v.string()),

  guestName: v.string(),
  guestEmail: v.optional(v.string()),
  guestPhone: v.optional(v.string()),
  numberOfGuests: v.optional(v.number()),

  // Dates (Unix timestamps in milliseconds)
  checkInAt: v.number(),
  checkOutAt: v.number(),

  // Flags
  lateCheckout: v.boolean(),
  earlyCheckin: v.boolean(),
  partyRiskFlag: v.boolean(),

  // Platform
  platform: v.optional(v.string()),
  confirmationCode: v.optional(v.string()),

  // Financial
  totalAmount: v.optional(v.number()),
  currency: v.optional(v.string()),

  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_hospitable", ["hospitableId"])
  .index("by_checkout", ["checkOutAt"])
  .index("by_checkin", ["checkInAt"])
  .index("by_property_dates", ["propertyId", "checkInAt", "checkOutAt"]);

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANING JOBS
// ═══════════════════════════════════════════════════════════════════════════════

const cleaningJobs = defineTable({
  propertyId: v.id("properties"),
  stayId: v.optional(v.id("stays")),
  templateId: v.optional(v.id("jobTemplates")),

  // Assignments
  assignedCleanerIds: v.array(v.id("users")),
  assignedManagerId: v.optional(v.id("users")),

  // Status
  status: v.union(
    v.literal("scheduled"),
    v.literal("assigned"),
    v.literal("in_progress"),
    v.literal("awaiting_approval"),
    v.literal("rework_required"),
    v.literal("completed"),
    v.literal("cancelled")
  ),

  // Scheduling (Unix timestamps in milliseconds)
  scheduledStartAt: v.number(),
  scheduledEndAt: v.number(),
  actualStartAt: v.optional(v.number()),
  actualEndAt: v.optional(v.number()),
  currentRevision: v.optional(v.number()),
  latestSubmissionId: v.optional(v.id("jobSubmissions")),

  // Approval
  approvedAt: v.optional(v.number()),
  approvedBy: v.optional(v.id("users")),
  rejectedAt: v.optional(v.number()),
  rejectedBy: v.optional(v.id("users")),
  rejectionReason: v.optional(v.string()),

  // Flags
  partyRiskFlag: v.boolean(),
  opsRiskFlag: v.boolean(),
  isUrgent: v.boolean(),

  // Notes
  notesForCleaner: v.optional(v.string()),
  completionNotes: v.optional(v.string()),
  managerNotes: v.optional(v.string()),

  // Checklist
  checklistItems: v.optional(v.array(v.object({
    id: v.string(),
    label: v.string(),
    completed: v.boolean(),
    completedAt: v.optional(v.number()),
  }))),

  // Per-cleaner assignment acknowledgements (accept/decline with expiry)
  acknowledgements: v.optional(v.array(v.object({
    cleanerId: v.id("users"),
    state: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    assignedAt: v.number(),
    expiresAt: v.number(),
    respondedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    notifiedOpsAt: v.optional(v.number()),
  }))),

  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_status", ["status"])
  .index("by_manager", ["assignedManagerId"])
  .index("by_scheduled", ["scheduledStartAt"])
  .index("by_property_and_scheduled", ["propertyId", "scheduledStartAt"])
  .index("by_property_status", ["propertyId", "status"])
  .index("by_stay", ["stayId"]);

const jobExecutionSessions = defineTable({
  jobId: v.id("cleaningJobs"),
  revision: v.number(),
  cleanerId: v.id("users"),
  status: v.union(
    v.literal("started"),
    v.literal("submitted"),
    v.literal("excused"),
  ),
  startedAtServer: v.number(),
  startedAtDevice: v.optional(v.number()),
  submittedAtServer: v.optional(v.number()),
  submittedAtDevice: v.optional(v.number()),
  lastHeartbeatAt: v.optional(v.number()),
  offlineStartToken: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_job_and_revision", ["jobId", "revision"])
  .index("by_job_and_cleaner_and_revision", ["jobId", "cleanerId", "revision"])
  .index("by_job_and_status", ["jobId", "status"]);

const jobSubmissions = defineTable({
  jobId: v.id("cleaningJobs"),
  revision: v.number(),
  submittedBy: v.optional(v.id("users")),
  submittedAtServer: v.number(),
  submittedAtDevice: v.optional(v.number()),
  status: v.union(v.literal("sealed"), v.literal("superseded")),
  roomReviewSnapshot: v.optional(
    v.array(
      v.object({
        roomName: v.string(),
        verdict: v.union(v.literal("pass"), v.literal("rework")),
        note: v.optional(v.string()),
      }),
    ),
  ),
  photoSnapshot: v.array(
    v.object({
      photoId: v.id("photos"),
      storageId: v.optional(v.id("_storage")),
      provider: v.optional(v.string()),
      bucket: v.optional(v.string()),
      objectKey: v.optional(v.string()),
      objectVersion: v.optional(v.string()),
      roomName: v.string(),
      type: v.union(
        v.literal("before"),
        v.literal("after"),
        v.literal("incident"),
      ),
      uploadedAt: v.number(),
      uploadedBy: v.optional(v.id("users")),
    }),
  ),
  checklistSnapshot: v.optional(
    v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        completed: v.boolean(),
        completedAt: v.optional(v.number()),
      }),
    ),
  ),
  incidentSnapshot: v.array(
    v.object({
      incidentId: v.id("incidents"),
      title: v.string(),
      description: v.optional(v.string()),
      roomName: v.optional(v.string()),
      severity: v.optional(
        v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
      ),
      status: v.union(
        v.literal("open"),
        v.literal("in_progress"),
        v.literal("resolved"),
        v.literal("wont_fix"),
      ),
      createdAt: v.number(),
    }),
  ),
  validationResult: v.object({
    mode: v.union(v.literal("standard"), v.literal("quick")),
    pass: v.boolean(),
    warnings: v.array(v.string()),
    errors: v.array(v.string()),
    summary: v.object({
      beforeCount: v.number(),
      afterCount: v.number(),
      incidentCount: v.number(),
      missingBeforeRooms: v.array(v.string()),
      missingAfterRooms: v.array(v.string()),
    }),
  }),
  sealedHash: v.string(),
  supersededAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_job", ["jobId"])
  .index("by_job_and_revision", ["jobId", "revision"])
  .index("by_job_and_created", ["jobId", "createdAt"]);

const jobAssignmentAuditEvents = defineTable({
  jobId: v.id("cleaningJobs"),
  propertyId: v.id("properties"),
  assignedBy: v.id("users"),
  assignedCleanerIds: v.array(v.id("users")),
  propertyCompanyId: v.optional(v.id("cleaningCompanies")),
  warnings: v.array(v.string()),
  source: v.optional(v.string()),
  overrideReason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_job", ["jobId"])
  .index("by_property", ["propertyId"])
  .index("by_assigned_by", ["assignedBy"])
  .index("by_created_at", ["createdAt"]);

const conversations = defineTable({
  linkedJobId: v.optional(v.id("cleaningJobs")),
  propertyId: v.optional(v.id("properties")),
  laneKind: v.optional(
    v.union(v.literal("internal_shared"), v.literal("whatsapp_cleaner")),
  ),
  linkedCleanerId: v.optional(v.id("users")),
  messagingEndpointId: v.optional(v.id("messagingEndpoints")),
  channel: v.union(
    v.literal("internal"),
    v.literal("sms"),
    v.literal("whatsapp"),
    v.literal("email"),
  ),
  kind: v.union(
    v.literal("job"),
    v.literal("direct"),
    v.literal("group"),
  ),
  status: v.union(v.literal("open"), v.literal("closed")),
  lastMessageAt: v.optional(v.number()),
  lastMessagePreview: v.optional(v.string()),
  createdBy: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_linked_job", ["linkedJobId"])
  .index("by_linked_job_and_lane_kind", ["linkedJobId", "laneKind"])
  .index("by_linked_job_and_lane_kind_and_linked_cleaner", [
    "linkedJobId",
    "laneKind",
    "linkedCleanerId",
  ])
  .index("by_messaging_endpoint", ["messagingEndpointId"])
  .index("by_status_last_message", ["status", "lastMessageAt"]);

const conversationParticipants = defineTable({
  conversationId: v.id("conversations"),
  userId: v.optional(v.id("users")),
  messagingEndpointId: v.optional(v.id("messagingEndpoints")),
  participantKind: v.union(
    v.literal("user"),
    v.literal("external_contact"),
  ),
  externalDisplayName: v.optional(v.string()),
  lastReadMessageAt: v.optional(v.number()),
  joinedAt: v.number(),
  mutedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_conversation", ["conversationId"])
  .index("by_user", ["userId"])
  .index("by_conversation_and_user", ["conversationId", "userId"])
  .index("by_conversation_and_messaging_endpoint", [
    "conversationId",
    "messagingEndpointId",
  ]);

const conversationMessages = defineTable({
  conversationId: v.id("conversations"),
  authorKind: v.union(
    v.literal("user"),
    v.literal("system"),
    v.literal("external_contact"),
  ),
  authorUserId: v.optional(v.id("users")),
  authorEndpointId: v.optional(v.id("messagingEndpoints")),
  messageKind: v.union(v.literal("user"), v.literal("system")),
  channel: v.union(
    v.literal("internal"),
    v.literal("sms"),
    v.literal("whatsapp"),
    v.literal("email"),
  ),
  body: v.string(),
  // Source language of the human-authored body (sender's UI locale at send
  // time). Rows without sourceLang are treated as "en" for backwards compat.
  sourceLang: v.optional(v.union(v.literal("en"), v.literal("es"))),
  // Lazy-filled cache of body translations, written by the translateMessage
  // action on first read in a different locale.
  translations: v.optional(
    v.object({
      en: v.optional(v.string()),
      es: v.optional(v.string()),
    }),
  ),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_conversation", ["conversationId"])
  .index("by_conversation_and_created", ["conversationId", "createdAt"]);

const messagingEndpoints = defineTable({
  userId: v.id("users"),
  channel: v.literal("whatsapp"),
  waId: v.string(),
  phoneNumber: v.string(),
  displayName: v.optional(v.string()),
  activeConversationId: v.optional(v.id("conversations")),
  optedInAt: v.number(),
  lastInboundAt: v.optional(v.number()),
  serviceWindowClosesAt: v.optional(v.number()),
  status: v.union(v.literal("active"), v.literal("blocked")),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_user_and_channel", ["userId", "channel"])
  .index("by_channel_and_wa_id", ["channel", "waId"])
  .index("by_channel_and_phone_number", ["channel", "phoneNumber"])
  .index("by_active_conversation", ["activeConversationId"]);

const whatsappLaneInvites = defineTable({
  token: v.string(),
  jobId: v.id("cleaningJobs"),
  cleanerUserId: v.id("users"),
  conversationId: v.optional(v.id("conversations")),
  createdBy: v.id("users"),
  expiresAt: v.number(),
  redeemedAt: v.optional(v.number()),
  redeemedEndpointId: v.optional(v.id("messagingEndpoints")),
  redeemedWaId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_token", ["token"])
  .index("by_job_and_cleaner_and_redeemed_at", [
    "jobId",
    "cleanerUserId",
    "redeemedAt",
  ])
  .index("by_conversation", ["conversationId"]);

const conversationMessageAttachments = defineTable({
  conversationId: v.id("conversations"),
  messageId: v.id("conversationMessages"),
  storageId: v.optional(v.id("_storage")),
  attachmentKind: v.union(
    v.literal("image"),
    v.literal("document"),
    v.literal("audio"),
  ),
  // Audio-specific metadata (populated only when attachmentKind === "audio").
  // The recorded length in milliseconds — used for the player UI and for
  // later aggregate cost analysis (seconds-of-audio-retained × storage rate).
  audioDurationMs: v.optional(v.number()),
  channel: v.union(
    v.literal("internal"),
    v.literal("sms"),
    v.literal("whatsapp"),
    v.literal("email"),
  ),
  mimeType: v.string(),
  fileName: v.string(),
  byteSize: v.number(),
  sourceUrl: v.optional(v.string()),
  providerMediaId: v.optional(v.string()),
  caption: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_message", ["messageId"])
  .index("by_conversation_and_created", ["conversationId", "createdAt"])
  .index("by_provider_media_id", ["providerMediaId"]);

const messageTransportEvents = defineTable({
  conversationId: v.optional(v.id("conversations")),
  messageId: v.optional(v.id("conversationMessages")),
  endpointId: v.optional(v.id("messagingEndpoints")),
  provider: v.literal("meta_whatsapp"),
  providerMessageId: v.optional(v.string()),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  currentStatus: v.union(
    v.literal("queued"),
    v.literal("received"),
    v.literal("sent"),
    v.literal("delivered"),
    v.literal("read"),
    v.literal("failed"),
  ),
  idempotencyKey: v.string(),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  payload: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  lastEventAt: v.optional(v.number()),
})
  .index("by_provider_and_provider_message_id", ["provider", "providerMessageId"])
  .index("by_idempotency_key", ["idempotencyKey"])
  .index("by_message", ["messageId"])
  .index("by_endpoint_and_created", ["endpointId", "createdAt"])
  .index("by_conversation_and_created", ["conversationId", "createdAt"]);

const jobTemplates = defineTable({
  propertyId: v.optional(v.id("properties")),
  name: v.string(),
  description: v.optional(v.string()),

  checklistItems: v.array(v.object({
    id: v.string(),
    label: v.string(),
    category: v.optional(v.string()),
    required: v.boolean(),
  })),

  inventoryPrompts: v.optional(v.array(v.object({
    itemName: v.string(),
    minQuantity: v.number(),
  }))),

  estimatedDuration: v.optional(v.number()),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_active", ["isActive"]);

// ═══════════════════════════════════════════════════════════════════════════════
// PHOTOS
// ═══════════════════════════════════════════════════════════════════════════════

const photos = defineTable({
  cleaningJobId: v.id("cleaningJobs"),
  storageId: v.optional(v.id("_storage")),
  provider: v.optional(v.string()),
  bucket: v.optional(v.string()),
  objectKey: v.optional(v.string()),
  objectVersion: v.optional(v.string()),
  /** Byte size of the stored object, if known. Populated by
   *  `completeExternalUpload` for B2/MinIO-backed photos. Enables accurate
   *  storage-cost snapshots — see `convex/serviceUsage/b2Snapshot.ts`. */
  byteSize: v.optional(v.number()),
  archivedTier: v.optional(v.string()),
  archivedAt: v.optional(v.number()),

  roomName: v.string(),
  type: v.union(
    v.literal("before"),
    v.literal("after"),
    v.literal("incident")
  ),
  source: v.union(
    v.literal("app"),
    v.literal("whatsapp"),
    v.literal("manual")
  ),

  annotations: v.optional(v.any()),
  notes: v.optional(v.string()),
  uploadedBy: v.optional(v.id("users")),
  uploadedAt: v.number(),
})
  .index("by_job", ["cleaningJobId"])
  .index("by_job_room", ["cleaningJobId", "roomName"])
  .index("by_job_type", ["cleaningJobId", "type"])
  .index("by_uploaded_at", ["uploadedAt"]);

const photoArchives = defineTable({
  photoId: v.id("photos"),
  sourceProvider: v.string(),
  sourceBucket: v.string(),
  sourceObjectKey: v.string(),
  archiveProvider: v.string(),
  archiveBucket: v.string(),
  archiveObjectKey: v.string(),
  status: v.union(v.literal("archived"), v.literal("failed")),
  attempts: v.number(),
  lastAttemptAt: v.number(),
  archivedAt: v.optional(v.number()),
  failedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_photo", ["photoId"])
  .index("by_status", ["status"])
  .index("by_archived_at", ["archivedAt"]);

// ═══════════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════════

const incidents = defineTable({
  cleaningJobId: v.optional(v.id("cleaningJobs")),
  propertyId: v.id("properties"),
  reportedBy: v.optional(v.id("users")),

  incidentType: v.union(
    v.literal("missing_item"),
    v.literal("damaged_item"),
    v.literal("maintenance_needed"),
    v.literal("guest_issue"),
    v.literal("suggestion"),
    v.literal("other")
  ),
  severity: v.optional(v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical")
  )),

  title: v.string(),
  description: v.optional(v.string()),
  roomName: v.optional(v.string()),

  inventoryItemId: v.optional(v.id("inventoryItems")),
  quantityMissing: v.optional(v.number()),
  photoIds: v.array(v.string()),

  customItemDescription: v.optional(v.string()),
  incidentContext: v.optional(v.string()),

  status: v.union(
    v.literal("open"),
    v.literal("in_progress"),
    v.literal("resolved"),
    v.literal("wont_fix")
  ),
  resolvedAt: v.optional(v.number()),
  resolvedBy: v.optional(v.id("users")),
  resolutionNotes: v.optional(v.string()),

  // Trello integration — card created on the Ops board when the incident is opened
  trelloCardId: v.optional(v.string()),
  trelloCardUrl: v.optional(v.string()),
  trelloCardShortLink: v.optional(v.string()),
  trelloSyncedAt: v.optional(v.number()),
  trelloSyncError: v.optional(v.string()),

  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_job", ["cleaningJobId"])
  .index("by_property", ["propertyId"])
  .index("by_created_at", ["createdAt"])
  .index("by_property_and_created_at", ["propertyId", "createdAt"])
  .index("by_status", ["status"])
  .index("by_severity", ["severity"])
  .index("by_reporter_and_created_at", ["reportedBy", "createdAt"]);

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════════════════════

const inventoryCategories = defineTable({
  name: v.string(),
  icon: v.optional(v.string()),
  sortOrder: v.number(),
  createdAt: v.number(),
})
  .index("by_name", ["name"])
  .index("by_order", ["sortOrder"]);

const inventoryItems = defineTable({
  propertyId: v.id("properties"),
  categoryId: v.optional(v.id("inventoryCategories")),
  name: v.string(),
  description: v.optional(v.string()),
  room: v.optional(v.string()),

  quantityPurchased: v.number(),
  quantityCurrent: v.number(),
  minimumQuantity: v.number(),

  status: v.union(
    v.literal("ok"),
    v.literal("low_stock"),
    v.literal("out_of_stock"),
    v.literal("reorder_pending")
  ),
  requiresRestock: v.boolean(),
  isRefillTracked: v.optional(v.boolean()),
  refillLowThresholdPct: v.optional(v.number()),
  refillCriticalThresholdPct: v.optional(v.number()),
  refillDisplayOrder: v.optional(v.number()),

  lastCheckedAt: v.optional(v.number()),
  lastCheckedBy: v.optional(v.id("users")),

  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_category", ["categoryId"])
  .index("by_status", ["status"])
  .index("by_property_room", ["propertyId", "room"])
  .searchIndex("search_name", { searchField: "name" });

const stockChecks = defineTable({
  jobId: v.id("cleaningJobs"),
  itemId: v.id("inventoryItems"),
  quantityBefore: v.number(),
  quantityAfter: v.number(),
  checkedBy: v.id("users"),
  checkedAt: v.number(),
  notes: v.optional(v.string()),
})
  .index("by_job", ["jobId"])
  .index("by_item", ["itemId"]);

const propertyCriticalCheckpoints = defineTable({
  propertyId: v.id("properties"),
  roomName: v.string(),
  title: v.string(),
  instruction: v.optional(v.string()),
  referenceStorageId: v.optional(v.id("_storage")),
  referenceImageUrl: v.optional(v.string()),
  linkedInventoryItemId: v.optional(v.id("inventoryItems")),
  isRequired: v.boolean(),
  isActive: v.boolean(),
  sortOrder: v.number(),
  createdBy: v.optional(v.id("users")),
  updatedBy: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_property_and_active", ["propertyId", "isActive"])
  .index("by_property_and_room", ["propertyId", "roomName"])
  .index("by_property_and_sort_order", ["propertyId", "sortOrder"]);

const jobCheckpointChecks = defineTable({
  jobId: v.id("cleaningJobs"),
  propertyId: v.id("properties"),
  revision: v.number(),
  checkpointId: v.id("propertyCriticalCheckpoints"),
  roomName: v.string(),
  status: v.union(v.literal("pass"), v.literal("fail"), v.literal("skip")),
  note: v.optional(v.string()),
  failPhotoStorageId: v.optional(v.id("_storage")),
  failPhotoUrl: v.optional(v.string()),
  autoIncidentId: v.optional(v.id("incidents")),
  checkedBy: v.id("users"),
  checkedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_job_and_revision", ["jobId", "revision"])
  .index("by_job_and_revision_and_checkpoint", ["jobId", "revision", "checkpointId"])
  .index("by_checkpoint", ["checkpointId"]);

const jobRefillChecks = defineTable({
  jobId: v.id("cleaningJobs"),
  propertyId: v.id("properties"),
  revision: v.number(),
  itemId: v.id("inventoryItems"),
  roomName: v.optional(v.string()),
  percentRemaining: v.number(),
  level: v.union(
    v.literal("ok"),
    v.literal("low"),
    v.literal("critical"),
    v.literal("out")
  ),
  note: v.optional(v.string()),
  checkedBy: v.id("users"),
  checkedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_job_and_revision", ["jobId", "revision"])
  .index("by_job_and_revision_and_item", ["jobId", "revision", "itemId"])
  .index("by_item", ["itemId"]);

const refillQueue = defineTable({
  propertyId: v.id("properties"),
  itemId: v.id("inventoryItems"),
  lastJobId: v.optional(v.id("cleaningJobs")),
  status: v.union(
    v.literal("open"),
    v.literal("acknowledged"),
    v.literal("ordered"),
    v.literal("resolved")
  ),
  level: v.union(v.literal("low"), v.literal("critical"), v.literal("out")),
  lastPercentRemaining: v.number(),
  note: v.optional(v.string()),
  lastCheckedAt: v.number(),
  lastCheckedBy: v.id("users"),
  acknowledgedAt: v.optional(v.number()),
  orderedAt: v.optional(v.number()),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_status", ["status"])
  .index("by_property_and_status", ["propertyId", "status"])
  .index("by_item", ["itemId"])
  .index("by_item_and_status", ["itemId", "status"]);

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

const notifications = defineTable({
  userId: v.id("users"),
  type: v.union(
    v.literal("job_assigned"),
    v.literal("job_at_risk"),
    v.literal("job_completed"),
    v.literal("awaiting_approval"),
    v.literal("rework_required"),
    v.literal("incident_created"),
    v.literal("low_stock"),
    v.literal("message_received"),
    v.literal("system")
  ),
  title: v.string(),
  message: v.string(),
  data: v.optional(v.any()),

  readAt: v.optional(v.number()),
  dismissedAt: v.optional(v.number()),

  pushSent: v.boolean(),
  pushSentAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_unread", ["userId", "readAt"])
  .index("by_type", ["type"]);

const notificationSchedules = defineTable({
  jobId: v.id("cleaningJobs"),
  type: v.string(),
  scheduledFor: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("sent"),
    v.literal("cancelled"),
    v.literal("failed")
  ),
  sentAt: v.optional(v.number()),
  error: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_pending", ["status", "scheduledFor"])
  .index("by_job", ["jobId"]);

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const instructionCategories = defineTable({
  name: v.string(),
  icon: v.optional(v.string()),
  sortOrder: v.number(),
  createdAt: v.number(),
})
  .index("by_name", ["name"])
  .index("by_order", ["sortOrder"]);

const instructions = defineTable({
  propertyId: v.optional(v.id("properties")),
  categoryId: v.optional(v.id("instructionCategories")),
  title: v.string(),
  content: v.string(),
  priority: v.optional(v.number()),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_property", ["propertyId"])
  .index("by_category", ["categoryId"])
  .index("by_active", ["isActive"]);

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

const reportExports = defineTable({
  requestedBy: v.id("users"),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("expired"),
  ),
  format: v.union(v.literal("csv"), v.literal("xlsx"), v.literal("pdf")),
  scope: v.object({
    preset: v.union(
      v.literal("7d"),
      v.literal("30d"),
      v.literal("90d"),
      v.literal("custom"),
    ),
    fromTs: v.number(),
    toTs: v.number(),
    propertyIds: v.array(v.id("properties")),
  }),
  storageId: v.optional(v.id("_storage")),
  mimeType: v.optional(v.string()),
  fileName: v.optional(v.string()),
  byteSize: v.optional(v.number()),
  error: v.optional(v.string()),
  rowCount: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_requested_by_and_created_at", ["requestedBy", "createdAt"])
  .index("by_status_and_created_at", ["status", "createdAt"])
  .index("by_status_and_expires_at", ["status", "expiresAt"])
  .index("by_created_at", ["createdAt"]);

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

const hospitableConfig = defineTable({
  propertyId: v.optional(v.string()),
  isActive: v.boolean(),
  syncWindowDays: v.optional(v.number()),
  lastSyncAt: v.optional(v.number()),
  lastSyncStatus: v.optional(v.string()),
  lastTestedAt: v.optional(v.number()),
  testStatus: v.optional(v.string()),
  propertyMappings: v.optional(v.array(v.object({
    hospitableId: v.string(),
    convexId: v.id("properties"),
  }))),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
});

// AI PROVIDERS (admin-configurable)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Single-row-per-feature table that controls which external AI provider is
// used for a given server-side feature (e.g. voice transcription). Admins
// change this from the /settings page — no redeploy needed.

const aiProviderSettings = defineTable({
  feature: v.union(
    v.literal("voice_transcription")
  ),
  providerKey: v.union(
    v.literal("gemini-flash"),
    v.literal("groq-whisper-turbo"),
    v.literal("openai-whisper")
  ),
  updatedBy: v.id("users"),
  updatedAt: v.number(),
  createdAt: v.number(),
})
  .index("by_feature", ["feature"]);

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS (admin-configurable UI gates)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generic one-row-per-flag table for toggling UI features on/off without a
// redeploy. Contract for the client:
//   - If no row exists for a given key → treat as DISABLED (safe default).
//   - If a row exists → use its `enabled` boolean.
// This lets us ship a flag off-by-default without a seeding mutation, and
// requires an admin to explicitly opt in before anything lights up.
//
// Adopt this pattern for every new user-facing feature:
//   1. Add the feature's key to the literal union below.
//   2. Add matching metadata in `convex/admin/featureFlags.ts`.
//   3. Gate the client render on `api.admin.featureFlags.isFeatureEnabled`.

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE USAGE TRACKING (Phase A — see Docs/usage-tracking/ADR.md)
// ═══════════════════════════════════════════════════════════════════════════════

const serviceUsageEvents = defineTable({
  serviceKey: v.union(
    v.literal("gemini"),
    v.literal("groq"),
    v.literal("openai"),
    v.literal("clerk"),
    v.literal("hospitable"),
    v.literal("resend"),
    v.literal("sentry"),
    v.literal("posthog"),
    v.literal("convex"),
    v.literal("b2"),
  ),
  feature: v.string(),
  status: v.union(
    v.literal("success"),
    v.literal("rate_limited"),
    v.literal("quota_exceeded"),
    v.literal("auth_error"),
    v.literal("client_error"),
    v.literal("server_error"),
    v.literal("timeout"),
    v.literal("unknown_error"),
  ),
  userId: v.optional(v.id("users")),
  durationMs: v.optional(v.number()),
  requestBytes: v.optional(v.number()),
  responseBytes: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  audioSeconds: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_service_created", ["serviceKey", "createdAt"])
  .index("by_feature_created", ["feature", "createdAt"])
  .index("by_status_created", ["status", "createdAt"])
  .index("by_user_created", ["userId", "createdAt"]);

const serviceUsageRollups = defineTable({
  serviceKey: v.string(),
  feature: v.string(),
  bucketStart: v.number(),
  bucketSize: v.literal("1h"),
  successCount: v.number(),
  errorCount: v.number(),
  totalDurationMs: v.number(),
  totalInputTokens: v.number(),
  totalOutputTokens: v.number(),
  totalAudioSeconds: v.number(),
  totalCostUsd: v.number(),
})
  .index("by_service_bucket", ["serviceKey", "bucketStart"])
  .index("by_feature_bucket", ["feature", "bucketStart"]);

const featureFlags = defineTable({
  key: v.union(
    v.literal("theme_switcher"),
    v.literal("voice_messages"),
    v.literal("voice_audio_attachments"),
    v.literal("usage_dashboard")
    // future flags go here
  ),
  enabled: v.boolean(),
  updatedBy: v.id("users"),
  updatedAt: v.number(),
  createdAt: v.number(),
}).index("by_key", ["key"]);

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

export default defineSchema({
  // Users & Auth
  users,
  userRoles,

  // Companies
  cleaningCompanies,
  companyMembers,
  companyProperties,

  // Properties
  properties,
  propertyImages,
  propertyTags,
  propertyOpsAssignments,

  // Stays
  stays,

  // Jobs
  cleaningJobs,
  jobTemplates,
  jobExecutionSessions,
  jobSubmissions,
  jobAssignmentAuditEvents,
  conversations,
  conversationParticipants,
  conversationMessages,
  messagingEndpoints,
  whatsappLaneInvites,
  conversationMessageAttachments,
  messageTransportEvents,

  // Photos
  photos,
  photoArchives,

  // Incidents
  incidents,

  // Inventory
  inventoryCategories,
  inventoryItems,
  stockChecks,
  propertyCriticalCheckpoints,
  jobCheckpointChecks,
  jobRefillChecks,
  refillQueue,

  // Notifications
  notifications,
  notificationSchedules,

  // Instructions
  instructionCategories,
  instructions,

  // Reports
  reportExports,

  // Integration
  hospitableConfig,

  // AI Providers (admin-configurable)
  aiProviderSettings,

  // Feature Flags (admin-controlled UI gates)
  featureFlags,

  // Service Usage Tracking (Phase A)
  serviceUsageEvents,
  serviceUsageRollups,
});
