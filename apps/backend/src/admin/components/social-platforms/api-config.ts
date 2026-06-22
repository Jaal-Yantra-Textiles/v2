/**
 * Single source of truth for the social-platform `api_config` shape.
 *
 * Both the create and edit forms map their flat react-hook-form values into the
 * nested `api_config` blob, and read existing `api_config` back into form
 * defaults. Keeping that mapping in two hand-maintained switch statements caused
 * silent drift — e.g. the edit form's `shipping` branch never learned about
 * Shiprocket's `email` / `password` / `pickup_location` fields, so editing a
 * Shiprocket platform dropped the email on save (#427). This module is the one
 * place the per-provider field set lives; add a new provider/category here and
 * both forms follow.
 *
 * Secrets: blank secret fields are intentionally omitted from the built config.
 * The create path simply doesn't send them; the edit path overlays the built
 * config onto the existing one and the backend (`preserveExistingSecrets` in
 * the admin route) restores any omitted secret — plaintext AND `*_encrypted`
 * blob — from the stored row. So neither form needs to round-trip secrets.
 */

/**
 * Parse comma-separated country codes into a normalized array of E.164
 * prefixes (e.g. "91, +61" → ["+91", "+61"]). Returns undefined for empty
 * input so api_config doesn't carry an empty array.
 */
export function parseCountryCodes(
  input: string | undefined | null
): string[] | undefined {
  if (!input) return undefined
  const codes = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("+") ? s : `+${s}`))
  return codes.length ? codes : undefined
}

/**
 * Build the `api_config` blob from flat form data for a given category. The
 * per-category/provider branches define which form fields belong to which
 * provider. Undefined/blank values are stripped at the end so the caller can
 * overlay the result onto an existing config without clobbering set values
 * with blanks (used by the edit path; the create path starts from `{}`).
 */
export function buildApiConfig(
  category: string,
  data: Record<string, any>
): Record<string, any> {
  const config: Record<string, any> = { provider: data.provider_type }

  switch (category) {
    case "email":
      if (data.provider_type === "imap") {
        Object.assign(config, {
          host: data.host,
          port: data.port || 993,
          user: data.username,
          password: data.password,
          tls: data.tls !== false,
          mailbox: data.mailbox || "INBOX",
        })
      } else {
        Object.assign(config, {
          api_key: data.api_key,
          webhook_signing_secret: data.webhook_signing_secret,
          inbound_domain: data.inbound_domain,
        })
      }
      break

    case "communication":
      Object.assign(config, {
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id,
        access_token: data.access_token,
        app_secret: data.app_secret,
        webhook_verify_token: data.webhook_verify_token,
        label: data.label,
        country_codes: parseCountryCodes(data.country_codes),
        // Three-way: explicit toggle wins; untouched (undefined) is dropped so
        // an overlay preserves the existing value. handleSubmit only sets this
        // when the field is dirty.
        is_default:
          data.is_default === true
            ? true
            : data.is_default === false
              ? false
              : undefined,
      })
      break

    case "sms":
      if (data.provider_type === "twilio") {
        Object.assign(config, {
          account_sid: data.account_sid,
          auth_token: data.auth_token,
          from_number: data.from_number,
          messaging_service_sid: data.messaging_service_sid,
        })
      } else {
        Object.assign(config, {
          api_key: data.api_key,
          originator: data.originator,
        })
      }
      break

    case "payment":
      Object.assign(config, {
        mode: data.mode || "test",
        api_key: data.api_key,
        secret_key: data.secret_key,
        publishable_key: data.publishable_key,
        webhook_secret: data.webhook_secret,
        client_id: data.client_id,
        client_secret: data.client_secret,
      })
      break

    case "shipping":
      if (data.provider_type === "shiprocket") {
        // Shiprocket authenticates with email/password (JWT) and references a
        // registered pickup-location name; no api_key/account_number.
        Object.assign(config, {
          mode: data.mode || "test",
          email: data.email,
          password: data.password,
          pickup_location: data.pickup_location,
        })
      } else {
        Object.assign(config, {
          mode: data.mode || "test",
          api_key: data.api_key,
          api_secret: data.api_secret,
          account_number: data.account_number,
        })
      }
      break

    case "analytics":
      Object.assign(config, {
        tracking_id: data.tracking_id,
        api_key: data.api_key,
        api_secret: data.api_secret,
        project_token: data.project_token,
        host: data.host,
      })
      break

    case "storage":
      Object.assign(config, {
        access_key_id: data.access_key_id,
        secret_access_key: data.secret_access_key,
        bucket: data.bucket,
        region: data.region,
        endpoint: data.endpoint,
        cloud_name: data.cloud_name,
        api_key: data.api_key,
        api_secret: data.api_secret,
        project_id: data.project_id,
      })
      break

    case "crm":
      Object.assign(config, {
        api_key: data.api_key,
        client_id: data.client_id,
        client_secret: data.client_secret,
        instance_url: data.instance_url,
        portal_id: data.portal_id,
      })
      break

    case "authentication":
      Object.assign(config, {
        domain: data.domain,
        client_id: data.client_id,
        client_secret: data.client_secret,
        audience: data.audience,
        secret_key: data.secret_key,
        publishable_key: data.publishable_key,
        project_id: data.project_id,
        api_key: data.api_key,
      })
      break

    case "ai": {
      // AI providers store provider_type/role/is_default in `metadata` (not
      // api_config) — see create-ai-platform-component.tsx. So the api_config
      // blob carries only the connection fields, and we deliberately DROP the
      // default `provider` key so create + edit produce an identical shape.
      const aiConfig: Record<string, any> = {
        api_key: data.api_key,
        default_model: data.default_model,
        account_id: data.account_id,
        base_url: data.base_url,
      }
      return Object.fromEntries(
        Object.entries(aiConfig).filter(([_, v]) => v !== undefined && v !== "")
      )
    }

    case "google":
      // Credentials are managed in the per-row Google Business Panel after
      // creation. No api_config built here — strip the default `provider` key.
      return {}
  }

  // Remove undefined/empty values so an overlay never clobbers a set value
  // with a blank (and the create path doesn't persist empty keys).
  return Object.fromEntries(
    Object.entries(config).filter(([_, v]) => v !== undefined && v !== "")
  )
}

/** Infer the platform `auth_type` from category + provider. */
export function inferAuthType(category: string, providerType?: string): string {
  switch (category) {
    case "email":
      return providerType === "resend" ? "api_key" : "basic"
    case "communication":
      return "bearer"
    case "sms":
      return providerType === "twilio" ? "basic" : "api_key"
    case "payment":
      return "api_key"
    case "shipping":
      return providerType === "shiprocket" ? "basic" : "api_key"
    case "analytics":
      return "api_key"
    case "storage":
      return "api_key"
    case "crm":
      return providerType === "hubspot" ? "api_key" : "oauth2"
    case "authentication":
      return "oauth2"
    case "ai":
      return "bearer"
    case "google":
      return "oauth2"
    default:
      return "api_key"
  }
}

/**
 * Map an existing (redacted) `api_config` back into flat form defaults so the
 * edit form pre-fills every provider's current values. Generic by design:
 * every non-secret key is copied through under its own name, with the few
 * fields whose form name differs from the api_config key aliased explicitly.
 * Secret values are never present in a redacted config (only `*_present`
 * hints), so secret inputs stay blank — leave them blank to keep the stored
 * secret, type to replace it.
 */
export function getFormDefaultsFromApiConfig(
  apiConfig: Record<string, any> | null | undefined
): Record<string, any> {
  if (!apiConfig || typeof apiConfig !== "object") return {}
  const out: Record<string, any> = {}

  for (const [key, value] of Object.entries(apiConfig)) {
    // Drop UI-only presence hints and encrypted blobs — never form values.
    if (key.endsWith("_present") || key.endsWith("_encrypted")) continue
    out[key] = value
  }

  // Aliases: form field name ≠ api_config key.
  if (apiConfig.provider !== undefined) out.provider_type = apiConfig.provider
  if (apiConfig.user !== undefined && apiConfig.username === undefined) {
    out.username = apiConfig.user
  }
  if (Array.isArray(apiConfig.country_codes)) {
    out.country_codes = apiConfig.country_codes.join(", ")
  }

  return out
}
