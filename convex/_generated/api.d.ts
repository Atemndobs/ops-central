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
import type * as admin_mutations from "../admin/mutations.js";
import type * as admin_queries from "../admin/queries.js";
import type * as admin_userSync from "../admin/userSync.js";
import type * as cleaningJobs_acknowledgements from "../cleaningJobs/acknowledgements.js";
import type * as cleaningJobs_approve from "../cleaningJobs/approve.js";
import type * as cleaningJobs_devResetJobs from "../cleaningJobs/devResetJobs.js";
import type * as cleaningJobs_mutations from "../cleaningJobs/mutations.js";
import type * as cleaningJobs_queries from "../cleaningJobs/queries.js";
import type * as cleaningJobs_reviewAccess from "../cleaningJobs/reviewAccess.js";
import type * as clerk_actions from "../clerk/actions.js";
import type * as conversations_lib from "../conversations/lib.js";
import type * as conversations_mutations from "../conversations/mutations.js";
import type * as conversations_queries from "../conversations/queries.js";
import type * as crons from "../crons.js";
import type * as dashboard_queries from "../dashboard/queries.js";
import type * as files_archiveActions from "../files/archiveActions.js";
import type * as files_archiveState from "../files/archiveState.js";
import type * as files_mutations from "../files/mutations.js";
import type * as files_queries from "../files/queries.js";
import type * as hospitable_actions from "../hospitable/actions.js";
import type * as hospitable_mutations from "../hospitable/mutations.js";
import type * as hospitable_queries from "../hospitable/queries.js";
import type * as http from "../http.js";
import type * as incidents_mutations from "../incidents/mutations.js";
import type * as incidents_queries from "../incidents/queries.js";
import type * as integrations_trello from "../integrations/trello.js";
import type * as inventory_queries from "../inventory/queries.js";
import type * as jobChecks_mutations from "../jobChecks/mutations.js";
import type * as jobChecks_queries from "../jobChecks/queries.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_externalStorage from "../lib/externalStorage.js";
import type * as lib_notificationLifecycle from "../lib/notificationLifecycle.js";
import type * as lib_opsNotifications from "../lib/opsNotifications.js";
import type * as lib_photoUrls from "../lib/photoUrls.js";
import type * as lib_profileMetadata from "../lib/profileMetadata.js";
import type * as lib_rooms from "../lib/rooms.js";
import type * as lib_translation from "../lib/translation.js";
import type * as notifications_actions from "../notifications/actions.js";
import type * as notifications_mutations from "../notifications/mutations.js";
import type * as notifications_queries from "../notifications/queries.js";
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
import type * as translation_actions from "../translation/actions.js";
import type * as translation_internal from "../translation/internal.js";
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
  "admin/mutations": typeof admin_mutations;
  "admin/queries": typeof admin_queries;
  "admin/userSync": typeof admin_userSync;
  "cleaningJobs/acknowledgements": typeof cleaningJobs_acknowledgements;
  "cleaningJobs/approve": typeof cleaningJobs_approve;
  "cleaningJobs/devResetJobs": typeof cleaningJobs_devResetJobs;
  "cleaningJobs/mutations": typeof cleaningJobs_mutations;
  "cleaningJobs/queries": typeof cleaningJobs_queries;
  "cleaningJobs/reviewAccess": typeof cleaningJobs_reviewAccess;
  "clerk/actions": typeof clerk_actions;
  "conversations/lib": typeof conversations_lib;
  "conversations/mutations": typeof conversations_mutations;
  "conversations/queries": typeof conversations_queries;
  crons: typeof crons;
  "dashboard/queries": typeof dashboard_queries;
  "files/archiveActions": typeof files_archiveActions;
  "files/archiveState": typeof files_archiveState;
  "files/mutations": typeof files_mutations;
  "files/queries": typeof files_queries;
  "hospitable/actions": typeof hospitable_actions;
  "hospitable/mutations": typeof hospitable_mutations;
  "hospitable/queries": typeof hospitable_queries;
  http: typeof http;
  "incidents/mutations": typeof incidents_mutations;
  "incidents/queries": typeof incidents_queries;
  "integrations/trello": typeof integrations_trello;
  "inventory/queries": typeof inventory_queries;
  "jobChecks/mutations": typeof jobChecks_mutations;
  "jobChecks/queries": typeof jobChecks_queries;
  "lib/auth": typeof lib_auth;
  "lib/externalStorage": typeof lib_externalStorage;
  "lib/notificationLifecycle": typeof lib_notificationLifecycle;
  "lib/opsNotifications": typeof lib_opsNotifications;
  "lib/photoUrls": typeof lib_photoUrls;
  "lib/profileMetadata": typeof lib_profileMetadata;
  "lib/rooms": typeof lib_rooms;
  "lib/translation": typeof lib_translation;
  "notifications/actions": typeof notifications_actions;
  "notifications/mutations": typeof notifications_mutations;
  "notifications/queries": typeof notifications_queries;
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
  "translation/actions": typeof translation_actions;
  "translation/internal": typeof translation_internal;
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
