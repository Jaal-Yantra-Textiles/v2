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
          '@/components': path.resolve(__dirname, './src/admin/components'),
          '@/lib/utils': path.resolve(__dirname, './src/admin/lib/utils'),
        },
        
        // Keep Medusa's existing resolve options
      },
      optimizeDeps: {
        include: ["@excalidraw/excalidraw"]
      },
      
      
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
