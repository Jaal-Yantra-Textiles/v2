import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import fs from "fs";
import path from "path";

/**
 * Serve analytics.min.js tracking script
 * 
 * This endpoint serves the minified client-side tracking script
 * without authentication, allowing any website to load it.
 * 
 * Usage: <script src="https://api.jaalyantra.in/web/analytics.js" defer></script>
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Path to minified analytics script
    const scriptPath = path.join(process.cwd(), "assets", "analytics.min.js");

    // Check if file exists
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({
        message: "Analytics script not found. Run 'yarn build:analytics' to generate it.",
      });
    }

    // Read the script
    const script = fs.readFileSync(scriptPath, "utf8");

    // Set appropriate headers
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
    res.setHeader("Access-Control-Allow-Origin", "*"); // Allow from any domain
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Send the script
    res.send(script);
  } catch (error: any) {
    console.error("[Analytics Script] Error serving script:", error);
    res.status(500).json({
      message: "Failed to serve analytics script",
      error: error.message,
    });
  }
};
