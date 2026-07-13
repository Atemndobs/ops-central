/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_cleanup from "../admin/cleanup.js";
import type * as admin_featureFlags from "../admin/featureFlags.js";
import type * as admin_fixSofiaRandallsRoles from "../admin/fixSofiaRandallsRoles.js";
import type * as admin_mutations from "../admin/mutations.js";
import type * as admin_ownerAssignment from "../admin/ownerAssignment.js";
import type * as admin_ownerOverview from "../admin/ownerOverview.js";
import type * as admin_queries from "../admin/queries.js";
import type * as admin_userSync from "../admin/userSync.js";
import type * as admin_wipeGoLiveData from "../admin/wipeGoLiveData.js";
import type * as ai_providers from "../ai/providers.js";
import type * as ai_settings from "../ai/settings.js";
import type * as appSettings from "../appSettings.js";
import type * as cleaningJobs_acknowledgements from "../cleaningJobs/acknowledgements.js";
import type * as cleaningJobs_approve from "../cleaningJobs/approve.js";
import type * as cleaningJobs_backfillMeta from "../cleaningJobs/backfillMeta.js";
import type * as cleaningJobs_backfillUserJobAssignments from "../cleaningJobs/backfillUserJobAssignments.js";
import type * as cleaningJobs_devClearStaleTimers from "../cleaningJobs/devClearStaleTimers.js";
import type * as cleaningJobs_devResetJobs from "../cleaningJobs/devResetJobs.js";
import type * as cleaningJobs_markPastDone from "../cleaningJobs/markPastDone.js";
import type * as cleaningJobs_mutations from "../cleaningJobs/mutations.js";
import type * as cleaningJobs_queries from "../cleaningJobs/queries.js";
import type * as cleaningJobs_reviewAccess from "../cleaningJobs/reviewAccess.js";
import type * as cleaningJobs_sideEffects from "../cleaningJobs/sideEffects.js";
import type * as cleaningJobs_unassignFuture from "../cleaningJobs/unassignFuture.js";
import type * as cleaningJobs_upcoming from "../cleaningJobs/upcoming.js";
import type * as clerk_actions from "../clerk/actions.js";
import type * as conversations_enhance from "../conversations/enhance.js";
import type * as conversations_lib from "../conversations/lib.js";
import type * as conversations_mutations from "../conversations/mutations.js";
import type * as conversations_queries from "../conversations/queries.js";
import type * as conversations_voice from "../conversations/voice.js";
import type * as crons from "../crons.js";
import type * as dashboard_queries from "../dashboard/queries.js";
import type * as files_archiveActions from "../files/archiveActions.js";
import type * as files_archiveState from "../files/archiveState.js";
import type * as files_mutations from "../files/mutations.js";
import type * as files_orphanCleanup from "../files/orphanCleanup.js";
import type * as files_orphanCleanupState from "../files/orphanCleanupState.js";
import type * as files_queries from "../files/queries.js";
import type * as guestReviews_actions from "../guestReviews/actions.js";
import type * as guestReviews_internalQueries from "../guestReviews/internalQueries.js";
import type * as guestReviews_mutations from "../guestReviews/mutations.js";
import type * as guestReviews_normalize from "../guestReviews/normalize.js";
import type * as guestReviews_queries from "../guestReviews/queries.js";
import type * as guestReviews_statusMachine from "../guestReviews/statusMachine.js";
import type * as hospitable_actions from "../hospitable/actions.js";
import type * as hospitable_diagnostics from "../hospitable/diagnostics.js";
import type * as hospitable_mutations from "../hospitable/mutations.js";
import type * as hospitable_queries from "../hospitable/queries.js";
import type * as hospitable_webhooks from "../hospitable/webhooks.js";
import type * as http from "../http.js";
import type * as incidents_mutations from "../incidents/mutations.js";
import type * as incidents_queries from "../incidents/queries.js";
import type * as integrations_mutations from "../integrations/mutations.js";
import type * as integrations_queries from "../integrations/queries.js";
import type * as integrations_trello from "../integrations/trello.js";
import type * as inventory_import from "../inventory/import.js";
import type * as inventory_queries from "../inventory/queries.js";
import type * as jobChecks_mutations from "../jobChecks/mutations.js";
import type * as jobChecks_queries from "../jobChecks/queries.js";
import type * as lib_adminNotifier from "../lib/adminNotifier.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_companyScope from "../lib/companyScope.js";
import type * as lib_effectiveFrom from "../lib/effectiveFrom.js";
import type * as lib_externalStorage from "../lib/externalStorage.js";
import type * as lib_mediaValidation from "../lib/mediaValidation.js";
import type * as lib_messageEnhance from "../lib/messageEnhance.js";
import type * as lib_notificationLifecycle from "../lib/notificationLifecycle.js";
import type * as lib_opsNotifications from "../lib/opsNotifications.js";
import type * as lib_opsTaskAuth from "../lib/opsTaskAuth.js";
import type * as lib_ownership from "../lib/ownership.js";
import type * as lib_photoStorageAggregate from "../lib/photoStorageAggregate.js";
import type * as lib_photoUrls from "../lib/photoUrls.js";
import type * as lib_profileMetadata from "../lib/profileMetadata.js";
import type * as lib_reviewResponseDraft from "../lib/reviewResponseDraft.js";
import type * as lib_reworkDeadline from "../lib/reworkDeadline.js";
import type * as lib_reworkNotifications from "../lib/reworkNotifications.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_rooms from "../lib/rooms.js";
import type * as lib_serviceRegistry from "../lib/serviceRegistry.js";
import type * as lib_serviceUsage from "../lib/serviceUsage.js";
import type * as lib_translation from "../lib/translation.js";
import type * as notifications_actions from "../notifications/actions.js";
import type * as notifications_mutations from "../notifications/mutations.js";
import type * as notifications_queries from "../notifications/queries.js";
import type * as opsTasks_mutations from "../opsTasks/mutations.js";
import type * as opsTasks_queries from "../opsTasks/queries.js";
import type * as owner_auth from "../owner/auth.js";
import type * as owner_backfill from "../owner/backfill.js";
import type * as owner_constants from "../owner/constants.js";
import type * as owner_engineInputs from "../owner/engineInputs.js";
import type * as owner_feeEngine from "../owner/feeEngine.js";
import type * as owner_mutations from "../owner/mutations.js";
import type * as owner_notify from "../owner/notify.js";
import type * as owner_pdf from "../owner/pdf.js";
import type * as owner_pdfHelpers from "../owner/pdfHelpers.js";
import type * as owner_queries from "../owner/queries.js";
import type * as properties_mutations from "../properties/mutations.js";
import type * as properties_queries from "../properties/queries.js";
import type * as properties_seed from "../properties/seed.js";
import type * as propertyChecks_mutations from "../propertyChecks/mutations.js";
import type * as propertyChecks_queries from "../propertyChecks/queries.js";
import type * as refills_mutations from "../refills/mutations.js";
import type * as refills_queries from "../refills/queries.js";
import type * as reports_actions from "../reports/actions.js";
import type * as reports_lib from "../reports/lib.js";
import type * as reports_mutations from "../reports/mutations.js";
import type * as reports_queries from "../reports/queries.js";
import type * as reviewAnnotations_mutations from "../reviewAnnotations/mutations.js";
import type * as reviewAnnotations_queries from "../reviewAnnotations/queries.js";
import type * as serviceUsage_b2Snapshot from "../serviceUsage/b2Snapshot.js";
import type * as serviceUsage_clerkSnapshot from "../serviceUsage/clerkSnapshot.js";
import type * as serviceUsage_convexSnapshot from "../serviceUsage/convexSnapshot.js";
import type * as serviceUsage_counterBackfill from "../serviceUsage/counterBackfill.js";
import type * as serviceUsage_crons from "../serviceUsage/crons.js";
import type * as serviceUsage_logger from "../serviceUsage/logger.js";
import type * as serviceUsage_providerSync from "../serviceUsage/providerSync.js";
import type * as serviceUsage_providerSyncWriter from "../serviceUsage/providerSyncWriter.js";
import type * as serviceUsage_providers_b2 from "../serviceUsage/providers/b2.js";
import type * as serviceUsage_providers_clerk from "../serviceUsage/providers/clerk.js";
import type * as serviceUsage_providers_convex from "../serviceUsage/providers/convex.js";
import type * as serviceUsage_providers_index from "../serviceUsage/providers/index.js";
import type * as serviceUsage_providers_types from "../serviceUsage/providers/types.js";
import type * as serviceUsage_queries from "../serviceUsage/queries.js";
import type * as strCosts_buckets from "../strCosts/buckets.js";
import type * as strCosts_costItems from "../strCosts/costItems.js";
import type * as strCosts_costMath from "../strCosts/costMath.js";
import type * as strCosts_mutations from "../strCosts/mutations.js";
import type * as strCosts_portfolio from "../strCosts/portfolio.js";
import type * as strCosts_queries from "../strCosts/queries.js";
import type * as strCosts_reports from "../strCosts/reports.js";
import type * as strCosts_viewResolution from "../strCosts/viewResolution.js";
import type * as strCosts_views from "../strCosts/views.js";
import type * as translation_actions from "../translation/actions.js";
import type * as translation_internal from "../translation/internal.js";
import type * as users_avatarBackfill from "../users/avatarBackfill.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";
import type * as whatsapp_actions from "../whatsapp/actions.js";
import type * as whatsapp_lib from "../whatsapp/lib.js";
import type * as whatsapp_mutations from "../whatsapp/mutations.js";
import type * as whatsapp_provider from "../whatsapp/provider.js";
import type * as whatsapp_queries from "../whatsapp/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/cleanup": typeof admin_cleanup;
  "admin/featureFlags": typeof admin_featureFlags;
  "admin/fixSofiaRandallsRoles": typeof admin_fixSofiaRandallsRoles;
  "admin/mutations": typeof admin_mutations;
  "admin/ownerAssignment": typeof admin_ownerAssignment;
  "admin/ownerOverview": typeof admin_ownerOverview;
  "admin/queries": typeof admin_queries;
  "admin/userSync": typeof admin_userSync;
  "admin/wipeGoLiveData": typeof admin_wipeGoLiveData;
  "ai/providers": typeof ai_providers;
  "ai/settings": typeof ai_settings;
  appSettings: typeof appSettings;
  "cleaningJobs/acknowledgements": typeof cleaningJobs_acknowledgements;
  "cleaningJobs/approve": typeof cleaningJobs_approve;
  "cleaningJobs/backfillMeta": typeof cleaningJobs_backfillMeta;
  "cleaningJobs/backfillUserJobAssignments": typeof cleaningJobs_backfillUserJobAssignments;
  "cleaningJobs/devClearStaleTimers": typeof cleaningJobs_devClearStaleTimers;
  "cleaningJobs/devResetJobs": typeof cleaningJobs_devResetJobs;
  "cleaningJobs/markPastDone": typeof cleaningJobs_markPastDone;
  "cleaningJobs/mutations": typeof cleaningJobs_mutations;
  "cleaningJobs/queries": typeof cleaningJobs_queries;
  "cleaningJobs/reviewAccess": typeof cleaningJobs_reviewAccess;
  "cleaningJobs/sideEffects": typeof cleaningJobs_sideEffects;
  "cleaningJobs/unassignFuture": typeof cleaningJobs_unassignFuture;
  "cleaningJobs/upcoming": typeof cleaningJobs_upcoming;
  "clerk/actions": typeof clerk_actions;
  "conversations/enhance": typeof conversations_enhance;
  "conversations/lib": typeof conversations_lib;
  "conversations/mutations": typeof conversations_mutations;
  "conversations/queries": typeof conversations_queries;
  "conversations/voice": typeof conversations_voice;
  crons: typeof crons;
  "dashboard/queries": typeof dashboard_queries;
  "files/archiveActions": typeof files_archiveActions;
  "files/archiveState": typeof files_archiveState;
  "files/mutations": typeof files_mutations;
  "files/orphanCleanup": typeof files_orphanCleanup;
  "files/orphanCleanupState": typeof files_orphanCleanupState;
  "files/queries": typeof files_queries;
  "guestReviews/actions": typeof guestReviews_actions;
  "guestReviews/internalQueries": typeof guestReviews_internalQueries;
  "guestReviews/mutations": typeof guestReviews_mutations;
  "guestReviews/normalize": typeof guestReviews_normalize;
  "guestReviews/queries": typeof guestReviews_queries;
  "guestReviews/statusMachine": typeof guestReviews_statusMachine;
  "hospitable/actions": typeof hospitable_actions;
  "hospitable/diagnostics": typeof hospitable_diagnostics;
  "hospitable/mutations": typeof hospitable_mutations;
  "hospitable/queries": typeof hospitable_queries;
  "hospitable/webhooks": typeof hospitable_webhooks;
  http: typeof http;
  "incidents/mutations": typeof incidents_mutations;
  "incidents/queries": typeof incidents_queries;
  "integrations/mutations": typeof integrations_mutations;
  "integrations/queries": typeof integrations_queries;
  "integrations/trello": typeof integrations_trello;
  "inventory/import": typeof inventory_import;
  "inventory/queries": typeof inventory_queries;
  "jobChecks/mutations": typeof jobChecks_mutations;
  "jobChecks/queries": typeof jobChecks_queries;
  "lib/adminNotifier": typeof lib_adminNotifier;
  "lib/auth": typeof lib_auth;
  "lib/companyScope": typeof lib_companyScope;
  "lib/effectiveFrom": typeof lib_effectiveFrom;
  "lib/externalStorage": typeof lib_externalStorage;
  "lib/mediaValidation": typeof lib_mediaValidation;
  "lib/messageEnhance": typeof lib_messageEnhance;
  "lib/notificationLifecycle": typeof lib_notificationLifecycle;
  "lib/opsNotifications": typeof lib_opsNotifications;
  "lib/opsTaskAuth": typeof lib_opsTaskAuth;
  "lib/ownership": typeof lib_ownership;
  "lib/photoStorageAggregate": typeof lib_photoStorageAggregate;
  "lib/photoUrls": typeof lib_photoUrls;
  "lib/profileMetadata": typeof lib_profileMetadata;
  "lib/reviewResponseDraft": typeof lib_reviewResponseDraft;
  "lib/reworkDeadline": typeof lib_reworkDeadline;
  "lib/reworkNotifications": typeof lib_reworkNotifications;
  "lib/roles": typeof lib_roles;
  "lib/rooms": typeof lib_rooms;
  "lib/serviceRegistry": typeof lib_serviceRegistry;
  "lib/serviceUsage": typeof lib_serviceUsage;
  "lib/translation": typeof lib_translation;
  "notifications/actions": typeof notifications_actions;
  "notifications/mutations": typeof notifications_mutations;
  "notifications/queries": typeof notifications_queries;
  "opsTasks/mutations": typeof opsTasks_mutations;
  "opsTasks/queries": typeof opsTasks_queries;
  "owner/auth": typeof owner_auth;
  "owner/backfill": typeof owner_backfill;
  "owner/constants": typeof owner_constants;
  "owner/engineInputs": typeof owner_engineInputs;
  "owner/feeEngine": typeof owner_feeEngine;
  "owner/mutations": typeof owner_mutations;
  "owner/notify": typeof owner_notify;
  "owner/pdf": typeof owner_pdf;
  "owner/pdfHelpers": typeof owner_pdfHelpers;
  "owner/queries": typeof owner_queries;
  "properties/mutations": typeof properties_mutations;
  "properties/queries": typeof properties_queries;
  "properties/seed": typeof properties_seed;
  "propertyChecks/mutations": typeof propertyChecks_mutations;
  "propertyChecks/queries": typeof propertyChecks_queries;
  "refills/mutations": typeof refills_mutations;
  "refills/queries": typeof refills_queries;
  "reports/actions": typeof reports_actions;
  "reports/lib": typeof reports_lib;
  "reports/mutations": typeof reports_mutations;
  "reports/queries": typeof reports_queries;
  "reviewAnnotations/mutations": typeof reviewAnnotations_mutations;
  "reviewAnnotations/queries": typeof reviewAnnotations_queries;
  "serviceUsage/b2Snapshot": typeof serviceUsage_b2Snapshot;
  "serviceUsage/clerkSnapshot": typeof serviceUsage_clerkSnapshot;
  "serviceUsage/convexSnapshot": typeof serviceUsage_convexSnapshot;
  "serviceUsage/counterBackfill": typeof serviceUsage_counterBackfill;
  "serviceUsage/crons": typeof serviceUsage_crons;
  "serviceUsage/logger": typeof serviceUsage_logger;
  "serviceUsage/providerSync": typeof serviceUsage_providerSync;
  "serviceUsage/providerSyncWriter": typeof serviceUsage_providerSyncWriter;
  "serviceUsage/providers/b2": typeof serviceUsage_providers_b2;
  "serviceUsage/providers/clerk": typeof serviceUsage_providers_clerk;
  "serviceUsage/providers/convex": typeof serviceUsage_providers_convex;
  "serviceUsage/providers/index": typeof serviceUsage_providers_index;
  "serviceUsage/providers/types": typeof serviceUsage_providers_types;
  "serviceUsage/queries": typeof serviceUsage_queries;
  "strCosts/buckets": typeof strCosts_buckets;
  "strCosts/costItems": typeof strCosts_costItems;
  "strCosts/costMath": typeof strCosts_costMath;
  "strCosts/mutations": typeof strCosts_mutations;
  "strCosts/portfolio": typeof strCosts_portfolio;
  "strCosts/queries": typeof strCosts_queries;
  "strCosts/reports": typeof strCosts_reports;
  "strCosts/viewResolution": typeof strCosts_viewResolution;
  "strCosts/views": typeof strCosts_views;
  "translation/actions": typeof translation_actions;
  "translation/internal": typeof translation_internal;
  "users/avatarBackfill": typeof users_avatarBackfill;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
  "whatsapp/actions": typeof whatsapp_actions;
  "whatsapp/lib": typeof whatsapp_lib;
  "whatsapp/mutations": typeof whatsapp_mutations;
  "whatsapp/provider": typeof whatsapp_provider;
  "whatsapp/queries": typeof whatsapp_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
