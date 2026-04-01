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
import type * as cleaningJobs_approve from "../cleaningJobs/approve.js";
import type * as cleaningJobs_mutations from "../cleaningJobs/mutations.js";
import type * as cleaningJobs_queries from "../cleaningJobs/queries.js";
import type * as cleaningJobs_reviewAccess from "../cleaningJobs/reviewAccess.js";
import type * as crons from "../crons.js";
import type * as dashboard_queries from "../dashboard/queries.js";
import type * as files_archiveActions from "../files/archiveActions.js";
import type * as files_archiveState from "../files/archiveState.js";
import type * as files_mutations from "../files/mutations.js";
import type * as files_queries from "../files/queries.js";
import type * as hospitable_actions from "../hospitable/actions.js";
import type * as hospitable_mutations from "../hospitable/mutations.js";
import type * as incidents_mutations from "../incidents/mutations.js";
import type * as inventory_queries from "../inventory/queries.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_externalStorage from "../lib/externalStorage.js";
import type * as lib_photoUrls from "../lib/photoUrls.js";
import type * as notifications_actions from "../notifications/actions.js";
import type * as notifications_mutations from "../notifications/mutations.js";
import type * as notifications_queries from "../notifications/queries.js";
import type * as properties_mutations from "../properties/mutations.js";
import type * as properties_queries from "../properties/queries.js";
import type * as reports_actions from "../reports/actions.js";
import type * as reports_lib from "../reports/lib.js";
import type * as reports_mutations from "../reports/mutations.js";
import type * as reports_queries from "../reports/queries.js";
import type * as reviewAnnotations_mutations from "../reviewAnnotations/mutations.js";
import type * as reviewAnnotations_queries from "../reviewAnnotations/queries.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";

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
  "cleaningJobs/approve": typeof cleaningJobs_approve;
  "cleaningJobs/mutations": typeof cleaningJobs_mutations;
  "cleaningJobs/queries": typeof cleaningJobs_queries;
  "cleaningJobs/reviewAccess": typeof cleaningJobs_reviewAccess;
  crons: typeof crons;
  "dashboard/queries": typeof dashboard_queries;
  "files/archiveActions": typeof files_archiveActions;
  "files/archiveState": typeof files_archiveState;
  "files/mutations": typeof files_mutations;
  "files/queries": typeof files_queries;
  "hospitable/actions": typeof hospitable_actions;
  "hospitable/mutations": typeof hospitable_mutations;
  "incidents/mutations": typeof incidents_mutations;
  "inventory/queries": typeof inventory_queries;
  "lib/auth": typeof lib_auth;
  "lib/externalStorage": typeof lib_externalStorage;
  "lib/photoUrls": typeof lib_photoUrls;
  "notifications/actions": typeof notifications_actions;
  "notifications/mutations": typeof notifications_mutations;
  "notifications/queries": typeof notifications_queries;
  "properties/mutations": typeof properties_mutations;
  "properties/queries": typeof properties_queries;
  "reports/actions": typeof reports_actions;
  "reports/lib": typeof reports_lib;
  "reports/mutations": typeof reports_mutations;
  "reports/queries": typeof reports_queries;
  "reviewAnnotations/mutations": typeof reviewAnnotations_mutations;
  "reviewAnnotations/queries": typeof reviewAnnotations_queries;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
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
