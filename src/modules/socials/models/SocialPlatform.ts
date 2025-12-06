import { model } from "@medusajs/framework/utils";
import SocialPost from "./SocialPost";
import AdAccount from "./AdAccount";
import Lead from "./Lead";

/**
 * SocialPlatform (External API Platform)
 * 
 * Represents an external API integration (social media, payment, shipping, etc.)
 * Stores encrypted credentials and configuration for API access.
 * 
 * @property category - API category (social, payment, shipping, email, etc.)
 * @property auth_type - Authentication method (oauth2, oauth1, api_key, bearer, basic)
 * @property api_config - Encrypted API configuration (tokens, keys, endpoints)
 * @property status - Platform status (active, inactive, error)
 */
const SocialPlatform = model.define("SocialPlatform", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  
  // External API categorization
  category: model.text().default("social"), // social, payment, shipping, email, sms, etc.
  auth_type: model.text().default("oauth2"), // oauth2, oauth1, api_key, bearer, basic
  
  // UI and display
  icon_url: model.text().nullable(),
  base_url: model.text().nullable(),
  description: model.text().nullable(),
  
  // Encrypted API configuration (stores EncryptedData objects)
  // Structure: { access_token_encrypted, refresh_token_encrypted, api_key_encrypted, etc. }
  api_config: model.json().nullable(),
  
  // Platform status
  status: model.text().default("active"), // active, inactive, error, pending
  
  // Additional metadata (non-sensitive data)
  metadata: model.json().nullable(),
  
  // Relationships
  posts: model.hasMany(() => SocialPost, { mappedBy: "platform" }),
  ad_accounts: model.hasMany(() => AdAccount, { mappedBy: "platform" }),
  leads: model.hasMany(() => Lead, { mappedBy: "platform" }),
});

export default SocialPlatform;
