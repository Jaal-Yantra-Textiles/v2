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
    //   resolve: "@medusajs/medusa/workflow-engine-redis",
    //   options: {
    //     redis: {
    //       url: process.env.REDIS_URL,
    //     },
    //   },
    // },
  ],
});
