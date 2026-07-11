import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils";
import path from "path";

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
      // Require email verification for partners registering with emailpass.
      // Native Medusa 2.16+ flow: login returns { verification_required, token },
      // then /auth/verification/request emits `auth.verification_requested`
      // (handled by src/subscribers/partner-verification-requested.ts to email
      // the code) and /auth/verification/confirm marks the identity verified.
      //
      // Opt-in via env (read at boot, mirrors STRIPE_CONNECT_ENABLED): when
      // required, an unverified partner's login returns an actorless token and
      // can't reach `/partners/*` until they verify. Left OFF by default so the
      // existing partner test suite (which never verifies) is unaffected; set
      // PARTNER_EMAIL_VERIFICATION=true in dev/prod to switch it on.
      // Spread a cast object so the extra key doesn't trip the excess-property
      // check on @medusajs/types versions that predate authVerificationsPerActor
      // (the prod build resolves an older type than local 2.17.1). Runtime is
      // unchanged — validate-verification reads projectConfig.http.authVerificationsPerActor.
      ...({
        authVerificationsPerActor: {
          partner:
            process.env.PARTNER_EMAIL_VERIFICATION === "true"
              ? [{ entity_type: "email", auth_provider: "emailpass" }]
              : [],
          investor:
            process.env.INVESTOR_EMAIL_VERIFICATION === "true"
              ? [{ entity_type: "email", auth_provider: "emailpass" }]
              : [],
        },
      } as any),
    },
    //redisUrl: process.env.REDIS_URL,
    //workerMode: process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server",
  },

  admin: {
    vite: () => ({
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src/admin"),
        },
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react-router-dom",
        ],
      },
      optimizeDeps: {
        include: ["pdf-lib", "qrcode"],
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

  plugins: [
    {
      resolve: "@medusajs/draft-order",
      options: {},
    },
    {
      resolve: "@medusajs/loyalty-plugin",
      options: {},
    },
    {
      resolve: "@jytextiles/medusa-plugin-etsy-sync",
      options: {
        keystring: process.env.ETSY_KEYSTRING ?? "",
        sharedSecret: process.env.ETSY_SHARED_SECRET ?? "",
        redirectUri:
          process.env.ETSY_REDIRECT_URI ??
          "http://localhost:9000/app/settings/oauth/etsy/callback",
        scope:
          process.env.ETSY_SCOPE ??
          "listings_r listings_w listings_d shops_r",
      },
    },
    {
      resolve: "@jytextiles/medusa-plugin-faire-store-sync",
      options: {
        clientId: process.env.FAIRE_APP_ID ?? "",
        clientSecret: process.env.FAIRE_APP_SECRET ?? "",
        redirectUri:
          process.env.FAIRE_REDIRECT_URI ??
          "http://localhost:9000/app/settings/oauth/faire/callback",
      },
    },
  ],

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
      resolve: "./src/modules/deployment",
      definition: { isQueryable: false },
    },
    {
      resolve: "./src/modules/custom-s3-provider",
    },
    {
      resolve: "./src/modules/socials",
    },
    {
      resolve: "./src/modules/social-provider",
      definition: { isQueryable: false },
    },
    {
      resolve: "./src/modules/partner-payment-config",
    },
    {
      resolve: "./src/modules/partner-onboarding-profile",
    },
    {
      resolve: "./src/modules/artisan-product-detail",
    },
    {
      resolve: "./src/modules/partner_billing",
    },
    {
      resolve: "./src/modules/fx_rates",
    },
    {
      resolve: "./src/modules/consumption_log",
    },
    {
      resolve: "./src/modules/energy_rates",
    },
    {
      resolve: "./src/modules/ai_usage",
    },
    {
      resolve: "./src/modules/unified_order_status",
    },
    {
      resolve: "./src/modules/platform-tax-identity",
    },
    {
      resolve: "./src/modules/investor",
    },

    // Production-ready modules
    // {
    //   resolve: "@medusajs/medusa/cache-redis",
    //   options: {
    //     redisUrl: process.env.REDIS_URL,
    //   },
    // },
    // {
    //   resolve: "@medusajs/medusa/event-bus-redis",
    //   options: {
    //     redisUrl: process.env.REDIS_URL,
    //   },
    // },
    // {
    //   resolve: "@medusajs/medusa/workflow-engine-redis",
    //   options: {
    //     redis: {
    //       redisUrl: process.env.REDIS_URL,
    //     },
    //   },
    // },

    // #342 PR-D (Chunk 8 / H2) — Locking Module with the Redis provider.
    // ACTIVE in prod via medusa-config.prod.ts (prod runs split server+worker,
    // so the #342 per-unified-order locks must hold across processes). Here in
    // the dev/test base config it stays commented — single-process dev/test use
    // the built-in in-memory locking provider, which needs no config. Kept as a
    // commented block to mirror the cache/event-bus/workflow-engine-redis blocks
    // above. The provider ships inside @medusajs/medusa as
    // `@medusajs/medusa/locking-redis` (NOT a separate top-level package).
    // {
    //   resolve: "@medusajs/medusa/locking",
    //   options: {
    //     providers: [
    //       {
    //         resolve: "@medusajs/medusa/locking-redis",
    //         id: "locking-redis",
    //         is_default: true,
    //         options: {
    //           redisUrl: process.env.LOCKING_REDIS_URL || process.env.REDIS_URL,
    //         },
    //       },
    //     ],
    //   },
    // },

    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/notification-local",
            id: "local",
            options: {
              channels: ["feed", "email"],
            },
          },
          {
            // Audit-only — the real WhatsApp send happens in
            // src/modules/social-provider/whatsapp-service.ts. This provider
            // exists so callers can persist a notification row via
            // notificationModuleService.createNotifications({ channel: "whatsapp", … })
            // after the upstream send succeeds.
            resolve: "./src/modules/notification-whatsapp-audit",
            id: "whatsapp-audit",
            options: {
              channels: ["whatsapp"],
            },
          },
        ],
      },
    },
    // {
    //   resolve: "@medusajs/medusa/caching",
    //   options: {
    //     providers: [
    //       {
    //         resolve: "@medusajs/caching-redis",
    //         id: "caching-redis",
    //         // Optional, makes this the default caching provider
    //         is_default: true,
    //         options: {
    //           redisUrl: process.env.REDIS_URL,
    //           // more options...
    //         },
    //       },
    //     ],
    //   },
    // },
    // {
    //   resolve: "@medusajs/medusa/file",
    //   options: {
    //     providers: [
    //       {
    //         resolve: "@medusajs/medusa/file-s3",
    //         id: "s3",
    //         options: {
    //           file_url: process.env.S3_FILE_URL,
    //           access_key_id: process.env.S3_ACCESS_KEY_ID,
    //           secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
    //           region: process.env.S3_REGION,
    //           bucket: process.env.S3_BUCKET,
    //           endpoint: process.env.S3_ENDPOINT,
    //         },
    //       },
    //     ],
    //   },
    // },
    // Payment module: register providers only when their creds are present, so
    // dev/test stay clean without keys (mirrors medusa-config.prod.ts). The
    // built-in system provider (pp_system_default) is always available.
    ...(process.env.STRIPE_API_KEY || process.env.PAYU_MERCHANT_KEY
      ? [
          {
            resolve: "@medusajs/medusa/payment",
            options: {
              providers: [
                ...(process.env.STRIPE_API_KEY
                  ? [
                      {
                        resolve: "@medusajs/medusa/payment-stripe",
                        id: "stripe",
                        options: {
                          apiKey: process.env.STRIPE_API_KEY,
                          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
                        },
                      },
                    ]
                  : []),
                ...(process.env.STRIPE_API_KEY &&
                process.env.STRIPE_CONNECT_ENABLED === "true"
                  ? [
                      {
                        resolve: "./src/modules/stripe-connect-payment",
                        id: "stripe-connect",
                        options: {
                          apiKey: process.env.STRIPE_API_KEY,
                          // Fee falls back to the partner plan's
                          // payment_processing_fee at runtime; this is only used
                          // when no plan is resolvable.
                          defaultFeePercent: process.env
                            .STRIPE_CONNECT_DEFAULT_FEE_PERCENT
                            ? Number(process.env.STRIPE_CONNECT_DEFAULT_FEE_PERCENT)
                            : 0,
                          refundApplicationFee: true,
                          allowPlatformFallback:
                            process.env.STRIPE_CONNECT_PLATFORM_FALLBACK === "true",
                        },
                      },
                    ]
                  : []),
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
        ]
      : []),
    // {
    //   resolve: "@medusajs/medusa/fulfillment",
    //   options: {
    //     providers: [
    //       {
    //         resolve: "@medusajs/medusa/fulfillment-manual",
    //         id: "manual",
    //       },
    //       ...(process.env.DELHIVERY_API_TOKEN
    //         ? [
    //             {
    //               resolve: "./src/modules/shipping-providers/delhivery",
    //               id: "delhivery",
    //               options: {
    //                 api_token: process.env.DELHIVERY_API_TOKEN,
    //                 sandbox: process.env.DELHIVERY_SANDBOX === "true",
    //               },
    //             },
    //           ]
    //         : []),
    //       ...(process.env.SHIPROCKET_EMAIL
    //         ? [
    //             {
    //               resolve: "./src/modules/shipping-providers/shiprocket",
    //               id: "shiprocket",
    //               options: {
    //                 email: process.env.SHIPROCKET_EMAIL,
    //                 password: process.env.SHIPROCKET_PASSWORD,
    //                 pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION,
    //               },
    //             },
    //           ]
    //         : []),
    //       ...(process.env.DHL_API_KEY
    //         ? [
    //             {
    //               resolve: "./src/modules/shipping-providers/dhl",
    //               id: "dhl-express",
    //               options: {
    //                 api_key: process.env.DHL_API_KEY,
    //                 api_secret: process.env.DHL_API_SECRET,
    //                 account_number: process.env.DHL_ACCOUNT_NUMBER,
    //                 sandbox: process.env.DHL_SANDBOX === "true",
    //               },
    //             },
    //           ]
    //         : []),
    //       ...(process.env.UPS_CLIENT_ID
    //         ? [
    //             {
    //               resolve: "./src/modules/shipping-providers/ups",
    //               id: "ups",
    //               options: {
    //                 client_id: process.env.UPS_CLIENT_ID,
    //                 client_secret: process.env.UPS_CLIENT_SECRET,
    //                 account_number: process.env.UPS_ACCOUNT_NUMBER,
    //                 sandbox: process.env.UPS_SANDBOX === "true",
    //               },
    //             },
    //           ]
    //         : []),
    //       ...(process.env.FEDEX_CLIENT_ID
    //         ? [
    //             {
    //               resolve: "./src/modules/shipping-providers/fedex",
    //               id: "fedex",
    //               options: {
    //                 client_id: process.env.FEDEX_CLIENT_ID,
    //                 client_secret: process.env.FEDEX_CLIENT_SECRET,
    //                 account_number: process.env.FEDEX_ACCOUNT_NUMBER,
    //                 sandbox: process.env.FEDEX_SANDBOX === "true",
    //               },
    //             },
    //           ]
    //         : []),
    //       ...(process.env.AUSPOST_CLIENT_ID
    //         ? [
    //             {
    //               resolve: "./src/modules/shipping-providers/auspost",
    //               id: "auspost",
    //               options: {
    //                 client_id: process.env.AUSPOST_CLIENT_ID,
    //                 client_secret: process.env.AUSPOST_CLIENT_SECRET,
    //                 account_number: process.env.AUSPOST_ACCOUNT_NUMBER,
    //                 sandbox: process.env.AUSPOST_SANDBOX === "true",
    //               },
    //             },
    //           ]
    //         : []),
    //     ],
    //   },
    // },
  {
    resolve: "./src/modules/email_templates",
  },
  {
    resolve: "./src/modules/agreements",
  },
  {
    resolve: "./src/modules/agreement-responses",
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
    definition: { isQueryable: false },
  },
  {
    resolve: "./src/modules/google_merchant",
  },
  {
    resolve: "./src/modules/ops_audit",
  },
  {
    resolve: "./src/modules/marketing",
  },
  {
    resolve: "./src/modules/encryption",
    definition: { isQueryable: false },
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
    resolve: "./src/modules/payment_submissions",
  },
  {
    resolve: "./src/modules/email-provider-manager",
  },
  {
    resolve: "./src/modules/email_suppression",
  },
  {
    resolve: "./src/modules/email_engagement",
  },
  {
    resolve: "./src/modules/audience",
  },
  {
    resolve: "./src/modules/messaging",
  },
  {
    resolve: "./src/modules/stats",
  },
],
});
