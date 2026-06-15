/**
 * @file Admin API routes for managing social platforms
 * @description Provides endpoints for retrieving, updating, and deleting social platforms in the JYT Commerce platform
 * @module API/Admin/SocialPlatforms
 */

/**
 * @typedef {Object} UpdateSocialPlatformInput
 * @property {string} [name] - The name of the social platform
 * @property {string} [icon] - The icon URL or identifier for the social platform
 * @property {string} [base_url] - The base URL for the social platform
 * @property {boolean} [is_active] - Whether the social platform is active
 * @property {Object} [metadata] - Additional metadata for the social platform
 */

/**
 * @typedef {Object} SocialPlatformResponse
 * @property {string} id - The unique identifier of the social platform
 * @property {string} name - The name of the social platform
 * @property {string} icon - The icon URL or identifier for the social platform
 * @property {string} base_url - The base URL for the social platform
 * @property {boolean} is_active - Whether the social platform is active
 * @property {Object} metadata - Additional metadata for the social platform
 * @property {Date} created_at - When the social platform was created
 * @property {Date} updated_at - When the social platform was last updated
 */

/**
 * Get a social platform by ID
 * @route GET /admin/social-platforms/:id
 * @group Social Platform - Operations related to social platforms
 * @param {string} id.path.required - The ID of the social platform to retrieve
 * @returns {Object} 200 - The requested social platform object
 * @throws {MedusaError} 400 - Invalid ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social platform not found
 *
 * @example request
 * GET /admin/social-platforms/socplat_123456789
 *
 * @example response 200
 * {
 *   "socialPlatform": {
 *     "id": "socplat_123456789",
 *     "name": "Facebook",
 *     "icon": "https://example.com/icons/facebook.png",
 *     "base_url": "https://facebook.com",
 *     "is_active": true,
 *     "metadata": {},
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Update a social platform
 * @route POST /admin/social-platforms/:id
 * @group Social Platform - Operations related to social platforms
 * @param {string} id.path.required - The ID of the social platform to update
 * @param {UpdateSocialPlatformInput} request.body.required - Social platform data to update
 * @returns {Object} 200 - The updated social platform object
 * @throws {MedusaError} 400 - Invalid input data or ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social platform not found
 *
 * @example request
 * POST /admin/social-platforms/socplat_123456789
 * {
 *   "name": "Meta",
 *   "icon": "https://example.com/icons/meta.png",
 *   "is_active": false
 * }
 *
 * @example response 200
 * {
 *   "socialPlatform": {
 *     "id": "socplat_123456789",
 *     "name": "Meta",
 *     "icon": "https://example.com/icons/meta.png",
 *     "base_url": "https://facebook.com",
 *     "is_active": false,
 *     "metadata": {},
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-06-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete a social platform
 * @route DELETE /admin/social-platforms/:id
 * @group Social Platform - Operations related to social platforms
 * @param {string} id.path.required - The ID of the social platform to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 400 - Invalid ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social platform not found
 * @throws {MedusaError} 409 - Social platform cannot be deleted (e.g., in use)
 *
 * @example request
 * DELETE /admin/social-platforms/socplat_123456789
 *
 * @example response 200
 * {
 *   "id": "socplat_123456789",
 *   "object": "social_platform",
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateSocialPlatform } from "../validators";
import { refetchSocialPlatform } from "../helpers";
import { listSocialPlatformWorkflow } from "../../../../workflows/socials/list-social-platform";
import { updateSocialPlatformWorkflow } from "../../../../workflows/socials/update-social-platform";
import { deleteSocialPlatformWorkflow } from "../../../../workflows/socials/delete-social-platform";
import { SOCIALS_MODULE } from "../../../../modules/socials";
import type SocialsService from "../../../../modules/socials/service";
import { ENCRYPTION_MODULE } from "../../../../modules/encryption";
import type EncryptionService from "../../../../modules/encryption/service";
import { encryptSocialPlatformCredentials } from "../../../../subscribers/social-platform-credentials-encryption";
import {
  redactSocialPlatform,
  isSecretRevealAllowed,
  preserveExistingSecrets,
} from "../secrets";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listSocialPlatformWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  // Secrets are stripped by default; a raw token comes back only for an
  // MFA-protected caller who explicitly asks (`?reveal_secrets=true`).
  const reveal = await isSecretRevealAllowed(req);
  const encryptionService = reveal
    ? (req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService)
    : undefined;
  res.status(200).json({
    socialPlatform: redactSocialPlatform(result[0][0], { reveal, encryptionService }),
  });
};

export const POST = async (req: MedusaRequest<UpdateSocialPlatform>, res: MedusaResponse) => {
  const body: any = { ...req.validatedBody };

  // Redacted responses no longer carry secrets, so an edit that touches an
  // unrelated field arrives with credentials missing from `api_config`.
  // Restore any omitted/blank secret from the existing row server-side so the
  // save never wipes live credentials (see secrets.ts).
  if (body.api_config && typeof body.api_config === "object") {
    const existing = await refetchSocialPlatform(req.params.id, req.scope);
    body.api_config = preserveExistingSecrets(
      body.api_config,
      (existing as any)?.api_config
    );
  }

  await updateSocialPlatformWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...body,
    },
  });

  // Encrypt any newly-submitted credentials synchronously so the response
  // reflects the final (encrypted) state. The subscriber still fires on the
  // emitted event; its guards make the second pass a no-op.
  await encryptSocialPlatformCredentials(req.params.id, req.scope);

  // Always refetch by the URL param. Never trust `result.id` — the service's
  // `updateSocialPlatforms({ selector, data })` returns an array, which has
  // previously led to stale/wrong-record responses.
  const socialPlatform = await refetchSocialPlatform(req.params.id, req.scope);

  // Enforce single-default invariant for WhatsApp: if this row was saved as
  // default, unset `is_default` on every other WhatsApp row.
  const apiConfig = (socialPlatform as any)?.api_config as Record<string, any> | null;
  const isWhatsApp = apiConfig?.provider === "whatsapp" || (socialPlatform as any)?.name === "WhatsApp";
  if (isWhatsApp && apiConfig?.is_default === true) {
    const socials = req.scope.resolve(SOCIALS_MODULE) as unknown as SocialsService;
    await socials.clearOtherWhatsAppDefaults((socialPlatform as any).id);
  }

  res.status(200).json({ socialPlatform: redactSocialPlatform(socialPlatform) });
};

export const PUT = POST;

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteSocialPlatformWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "social_platform",
    deleted: true,
  });
};
