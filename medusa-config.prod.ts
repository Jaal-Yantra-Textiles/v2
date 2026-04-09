import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils";
import path from "path";

loadEnv("production", process.cwd());

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
    redisUrl: process.env.REDIS_URL,
    workerMode: process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server",
  },

  admin: {
    vite: () => ({
      // Keep Medusa's default config
       resolve: {
              alias: {
                "@": path.resolve(__dirname, "./src/admin"),
              }
              // Keep Medusa's existing resolve options
            },
            css: {
        preprocessorOptions: {
          scss: {
            api: 'modern-compiler' // or "modern"
          }
        }
      }
    }),
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL,
    
  },
  featureFlags: {
     translation: true,
     index_engine: true,
     view_configrations: true,
  },

  modules: [
    // Custom app modules
    {
      resolve: "./src/modules/person",
    },
    {
      resolve: "./src/modules/persontype",
    },
    {
      resolve: "./src/modules/inventory_orders",
    },
    {
      resolve: "./src/modules/internal_payments",
    },
    {
      resolve: "./src/modules/company",
    },
    {
      resolve: "./src/modules/website",
    },
    {
      resolve: "./src/modules/designs",
      dependencies: [Modules.LINK],
    },
    {
      resolve: "./src/modules/raw_material",
    },
    {
      resolve: "./src/modules/tasks",
    },
    {
      resolve: "./src/modules/notes",
    },
    {
      resolve: "./src/modules/partner",
    },
     {
      resolve: "./src/modules/partner-plan",
    },
    {
      resolve: "./src/modules/custom-s3-provider",
    },
    {
      resolve: "./src/modules/socials",
    },
    {
      resolve: "./src/modules/social-provider",
    },

    // Production-ready modules
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/caching-redis",
            id: "caching-redis",
            // Optional, makes this the default caching provider
            is_default: true,
            options: {
              redisUrl: process.env.REDIS_URL,
              // more options...
            },
          },
        ],
      },
    },  
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          redisUrl: process.env.REDIS_URL,
        },
      },
    },

    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "./src/modules/resend",
            id: "resend",
            options: {
              channels: ["email"],
              api_key: process.env.RESEND_API_KEY,
              from: process.env.RESEND_FROM_EMAIL,
            },
          },
          {
            resolve: "./src/modules/mailjet",
            id: "mailjet",
            options: {
              channels: ["email_bulk"],
              api_key: process.env.MAILJET_API_KEY,
              secret_key: process.env.MAILJET_SECRET_KEY,
              from_email: process.env.MAILJET_FROM_EMAIL,
              from_name: process.env.MAILJET_FROM_NAME || "Jaal Yantra Textiles",
            },
          },
          {
            resolve: "./src/modules/maileroo",
            id: "maileroo",
            options: {
              channels: ["email_partner"],
              api_key: process.env.MAILEROO_API_KEY,
              from_email: process.env.MAILEROO_FROM_EMAIL || "partner@partner.jaalyantra.com",
              from_name: process.env.MAILEROO_FROM_NAME || "Jaal Yantra Textiles Partners",
            },
          },
          {
            resolve: "@medusajs/medusa/notification-local",
            id: "local",
            options: {
              channels: ["feed"],
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: process.env.S3_FILE_URL,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
              endpoint: process.env.S3_ENDPOINT,
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
         ...(process.env.PAYU_MERCHANT_KEY
            ? [
                {
                  resolve: "./src/modules/payu-payment",
                  id: "payu",
                  options: {
                    merchant_key: process.env.PAYU_MERCHANT_KEY,
                    merchant_salt: process.env.PAYU_MERCHANT_SALT,
                    mode: process.env.PAYU_MODE || "test",
                    auto_capture: true,
                  },
                },
              ]
            : []),
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/fulfillment-manual",
            id: "manual",
          },
          ...(process.env.DELHIVERY_API_TOKEN
            ? [
                {
                  resolve: "./src/modules/shipping-providers/delhivery",
                  id: "delhivery",
                  options: {
                    api_token: process.env.DELHIVERY_API_TOKEN,
                    sandbox: process.env.DELHIVERY_SANDBOX === "true",
                  },
                },
              ]
            : []),
          ...(process.env.DHL_API_KEY
            ? [
                {
                  resolve: "./src/modules/shipping-providers/dhl",
                  id: "dhl-express",
                  options: {
                    api_key: process.env.DHL_API_KEY,
                    api_secret: process.env.DHL_API_SECRET,
                    account_number: process.env.DHL_ACCOUNT_NUMBER,
                    sandbox: process.env.DHL_SANDBOX === "true",
                  },
                },
              ]
            : []),
          ...(process.env.UPS_CLIENT_ID
            ? [
                {
                  resolve: "./src/modules/shipping-providers/ups",
                  id: "ups",
                  options: {
                    client_id: process.env.UPS_CLIENT_ID,
                    client_secret: process.env.UPS_CLIENT_SECRET,
                    account_number: process.env.UPS_ACCOUNT_NUMBER,
                    sandbox: process.env.UPS_SANDBOX === "true",
                  },
                },
              ]
            : []),
          ...(process.env.FEDEX_CLIENT_ID
            ? [
                {
                  resolve: "./src/modules/shipping-providers/fedex",
                  id: "fedex",
                  options: {
                    client_id: process.env.FEDEX_CLIENT_ID,
                    client_secret: process.env.FEDEX_CLIENT_SECRET,
                    account_number: process.env.FEDEX_ACCOUNT_NUMBER,
                    sandbox: process.env.FEDEX_SANDBOX === "true",
                  },
                },
              ]
            : []),
          ...(process.env.AUSPOST_CLIENT_ID
            ? [
                {
                  resolve: "./src/modules/shipping-providers/auspost",
                  id: "auspost",
                  options: {
                    client_id: process.env.AUSPOST_CLIENT_ID,
                    client_secret: process.env.AUSPOST_CLIENT_SECRET,
                    account_number: process.env.AUSPOST_ACCOUNT_NUMBER,
                    sandbox: process.env.AUSPOST_SANDBOX === "true",
                  },
                },
              ]
            : []),
        ],
      },
    },
  {
    resolve: "./src/modules/email_templates",
  },
  {
    resolve: "./src/modules/agreements",
  },
  {
    resolve: "./src/modules/media",
  },
  {
    resolve: "./src/modules/fullfilled_orders",
  },
  {
    resolve: "@medusajs/index",
  },
  {
    resolve: "./src/modules/feedback",
  },
  {
    resolve: "./src/modules/analytics",
  },
  {
    resolve: "./src/modules/etsysync",
  },
  {
    resolve: "./src/modules/external_stores",
  },
  {
    resolve: "./src/modules/encryption",
  },
  {
    resolve: "./src/modules/visual_flows",
  },
  {
    resolve: "./src/modules/aivtwo",
  },
  {
    resolve: "./src/modules/forms",
  },
  {
      resolve: "./src/modules/production_runs",
  },
  {
    resolve: "./src/modules/production_policy",
  },
  {
    resolve: "./src/modules/ad-planning",
  },
  {
    resolve: "./src/modules/spec_store",
  },
   {
      resolve: "@medusajs/medusa/translation",
    },
    {
    resolve: "./src/modules/inbound_emails",
  },
   {
      resolve: "./src/modules/hang_tag_settings",
    },
  {
    resolve: "./src/modules/payment_reports",
  },
  {
      resolve: "./src/modules/deployment",
    },
  {
    resolve: "./src/modules/email-provider-manager",
  },
  {
      resolve: "./src/modules/partner-payment-config",
    },
    {
      resolve: "./src/modules/consumption_log",
    },
    {
    resolve: "./src/modules/payment_submissions",
  },
   {
    resolve: "./src/modules/agreement-responses",
  },
],
});
