import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils";
import path from "path";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

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
      optimizeDeps: {
        include: ["@excalidraw/excalidraw"]
      },
      css: {
        preprocessorOptions: {
          scss: {
            api: 'modern-compiler' // or "modern"
          }
        }
      }
    })
  },
  modules: [
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
      resolve: "./src/modules/production_runs",
    },
    {
      resolve: "./src/modules/notes",
    },
    {
      resolve: "./src/modules/partner",
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
    {
      resolve: "./src/modules/email_templates",
    },
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [{
          resolve: "@medusajs/medusa/notification-local",
          id: "local",
          options: {
            channels: ["feed", "email"],
          },
        }]
      }
    },
    // {
    //   resolve: "@medusajs/medusa/notification",
    //   options: {
    //     providers: [
    //       {
    //         resolve: "./src/modules/resend",
    //         id: "resend",
    //         options: {
    //           channels: ["email"],
    //           api_key: process.env.RESEND_API_KEY,
    //           from: process.env.RESEND_FROM_EMAIL,
    //         },
    //       },
    //     ],
    //   },
    // }, 
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-local",
            id: "local",
          },
        ],
      },
    },
    
    // {
    //   resolve: "@medusajs/medusa/payment",
    //   options: {
    //     providers: [
    //       {
    //         resolve: "@medusajs/medusa/payment-stripe",
    //         id: "stripe",
    //         options: {
    //           apiKey: process.env.STRIPE_API_KEY,
    //         },
    //       },
    //     ],
    //   },
    // },
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
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-local",
            id: "local",
            options: {
              // provider options...
            },
          },
        ],
      },
    },
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
  {
    resolve: "./src/modules/feedback",
  },
  {
    resolve: "./src/modules/aivtwo",
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
    resolve: "./src/modules/forms",
  },
   {
      resolve: "@medusajs/medusa/translation",
  },
]

    // {
    //   resolve: "@medusajs/medusa/workflow-engine-redis",
    //   options: {
    //     redis: {
    //       url: process.env.REDIS_URL,
    //     },
    //   },
    // },

    
});
