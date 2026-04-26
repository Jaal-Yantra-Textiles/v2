#!/usr/bin/env node

/**
 * extract-plugin.mjs — Automate extraction of JYT modules into standalone Medusa plugins.
 *
 * Usage:
 *   node scripts/extract-plugin.mjs media                     # Scaffold + build + yalc publish
 *   node scripts/extract-plugin.mjs media --skip-build         # Scaffold only, no build
 *   node scripts/extract-plugin.mjs media --delete-originals   # Also remove from main app
 *   node scripts/extract-plugin.mjs --list                     # List all extractable modules
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLUGIN_BASE = path.resolve(os.homedir(), "Documents", "jyt-plugins");

// ─── Shared admin infrastructure files (copied when plugin has admin UI) ───

const SHARED_ADMIN_FILES = [
  "src/admin/lib/config.ts",
  "src/admin/lib/query-client.ts",
  "src/admin/lib/query-key-factory.tsx",
  "src/admin/lib/utils.ts",
  "src/admin/components/common/form.tsx",
  "src/admin/components/common/action-menu.tsx",
  "src/admin/components/common/conditional-tooltip.tsx",
  "src/admin/components/common/metadata-section.tsx",
  "src/admin/components/common/public-metadata-section.tsx",
  "src/admin/components/modal",
  "src/admin/components/utilitites/key-bound-form.tsx",
  "src/admin/components/pages/two-column-pages.tsx",
  "src/admin/components/pages/single-column-pages.tsx",
  "src/admin/components/table/skeleton.tsx",
  "src/admin/components/persons/personsActions.tsx",
  "src/admin/components/creates/create-button.tsx",
  "src/admin/components/ui/spinner.tsx",
  "src/admin/components/common/file-upload.tsx",
  "src/admin/components/common/json-view-section.tsx",
  "src/admin/components/layout/types.ts",
];

// All @medusajs packages — handled by scaffolding template, skip during detection
const MEDUSA_DEV_PACKAGES = new Set([
  "@medusajs/admin-sdk",
  "@medusajs/admin-shared",
  "@medusajs/cli",
  "@medusajs/framework",
  "@medusajs/medusa",
  "@medusajs/test-utils",
  "@medusajs/ui",
  "@medusajs/icons",
  "@medusajs/types",
  "@medusajs/js-sdk",
  "@medusajs/utils",
  "@medusajs/orchestration",
  "@medusajs/workflows-sdk",
  "@medusajs/index",
]);

// Packages that should be excluded from plugin dependencies entirely
const EXCLUDED_PACKAGES = new Set([
  "supertest",
  "@mikro-orm/migrations",
  "@mikro-orm/cli",
  "@mikro-orm/core",
  "@mikro-orm/postgresql",
  "jest",
  "@types/jest",
]);

// Fallback versions for common transitive dependencies not in root package.json
const FALLBACK_VERSIONS = {
  zod: "^3.23.0",
  clsx: "^2.1.0",
  "tailwind-merge": "^2.3.0",
  "react-i18next": "^14.1.0",
  "@radix-ui/react-label": "^2.0.2",
  "@radix-ui/react-slot": "^1.0.2",
  "@hookform/resolvers": "^3.3.0",
  "react-hook-form": "^7.51.0",
  "@aws-sdk/client-s3": "^3.600.0",
  "@aws-sdk/s3-request-presigner": "^3.600.0",
  "multer": "^1.4.5-lts.1",
  "@types/multer": "^1.4.12",
  "lucide-react": "^0.447.0",
  "framer-motion": "^11.0.0",
};

// Packages that should always be in devDependencies for plugins with admin UI
const ADMIN_DEV_DEPS = {
  "@tanstack/react-query": "^5.0.0",
  "@tanstack/react-table": "^8.0.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.0.0",
  "prop-types": "^15.8.1",
  "@types/react": "^18.3.2",
  "@types/react-dom": "^18.2.25",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`\x1b[36m→\x1b[0m ${msg}`);
}
function success(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1b[33m!\x1b[0m ${msg}`);
}
function error(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}

function copyPath(src, dest) {
  if (!fs.existsSync(src)) {
    warn(`Source not found, skipping: ${path.relative(ROOT, src)}`);
    return false;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDirRecursive(src, dest);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return true;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function deleteDirRecursive(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readMedusaVersion() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  );
  const ver =
    rootPkg.dependencies?.["@medusajs/framework"] ||
    rootPkg.devDependencies?.["@medusajs/framework"];
  // Strip leading ^ or ~ if present
  return ver?.replace(/^[\^~]/, "") || "2.13.1";
}

function readRootDependencies() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  );
  return { ...rootPkg.dependencies, ...rootPkg.devDependencies };
}

function loadConfig() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "plugin-config.json"), "utf8")
  );
}

// ─── Step 1: Scaffold plugin directory ────────────────────────────────────────

function scaffoldPlugin(moduleName, entry, medusaVersion) {
  const pluginDir = path.join(
    PLUGIN_BASE,
    `plugin-${moduleName.replace(/_/g, "-")}`
  );

  if (fs.existsSync(pluginDir)) {
    warn(`Plugin directory already exists: ${pluginDir}`);
    warn("Removing and re-scaffolding...");
    deleteDirRecursive(pluginDir);
  }

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, "src"), { recursive: true });

  // package.json
  const packageJson = {
    name: entry.pluginName,
    version: "0.0.1",
    description: entry.description,
    files: [".medusa/server"],
    exports: {
      "./package.json": "./package.json",
      "./workflows": "./.medusa/server/src/workflows/index.js",
      "./.medusa/server/src/modules/*":
        "./.medusa/server/src/modules/*/index.js",
      "./modules/*": "./.medusa/server/src/modules/*/index.js",
      "./*": "./.medusa/server/src/*.js",
    },
    keywords: [
      "medusa",
      "plugin",
      "medusa-plugin-other",
      "medusa-plugin",
      "medusa-v2",
    ],
    scripts: {
      build: "medusa plugin:build",
      dev: "medusa plugin:develop",
      prepublishOnly: "medusa plugin:build",
    },
    devDependencies: {
      "@medusajs/admin-sdk": medusaVersion,
      "@medusajs/admin-shared": medusaVersion,
      "@medusajs/cli": medusaVersion,
      "@medusajs/framework": medusaVersion,
      "@medusajs/medusa": medusaVersion,
      "@medusajs/test-utils": medusaVersion,
      "@medusajs/ui": "^4.0.29",
      "@medusajs/icons": medusaVersion,
      "@swc/core": "^1.7.28",
      "@types/node": "^20.0.0",
      "ts-node": "^10.9.2",
      typescript: "^5.6.2",
      vite: "^5.2.11",
      yalc: "^1.0.0-pre.53",
    },
    peerDependencies: {
      "@medusajs/admin-sdk": `^${medusaVersion}`,
      "@medusajs/cli": `^${medusaVersion}`,
      "@medusajs/framework": `^${medusaVersion}`,
      "@medusajs/test-utils": `^${medusaVersion}`,
      "@medusajs/medusa": `^${medusaVersion}`,
      "@medusajs/ui": "^4.0.29",
      "@medusajs/icons": `^${medusaVersion}`,
    },
    dependencies: {
      "@medusajs/js-sdk": `^${medusaVersion}`,
      "@medusajs/utils": `^${medusaVersion}`,
    },
    engines: { node: ">=20" },
  };

  // Add admin dev deps if plugin has admin UI
  if (entry.hasAdminUI) {
    Object.assign(packageJson.devDependencies, ADMIN_DEV_DEPS);
    // Add admin export
    packageJson.exports["./admin"] = {
      import: "./.medusa/server/src/admin/index.mjs",
      require: "./.medusa/server/src/admin/index.js",
      default: "./.medusa/server/src/admin/index.js",
    };
  }

  fs.writeFileSync(
    path.join(pluginDir, "package.json"),
    JSON.stringify(packageJson, null, 2) + "\n"
  );

  // tsconfig.json (server)
  const tsconfig = {
    compilerOptions: {
      target: "ES2021",
      esModuleInterop: true,
      module: "Node16",
      moduleResolution: "Node16",
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      declaration: false,
      sourceMap: false,
      inlineSourceMap: true,
      outDir: "./.medusa/server",
      rootDir: "./",
      jsx: "react-jsx",
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      checkJs: false,
      strictNullChecks: true,
    },
    "ts-node": { swc: true },
    include: ["**/*", ".medusa/types/*"],
    exclude: [
      "node_modules",
      ".medusa/server",
      ".medusa/admin",
      "src/admin",
      ".cache",
    ],
  };
  fs.writeFileSync(
    path.join(pluginDir, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2) + "\n"
  );

  // Admin tsconfig + vite-env.d.ts (if admin UI)
  if (entry.hasAdminUI) {
    const adminDir = path.join(pluginDir, "src", "admin");
    fs.mkdirSync(adminDir, { recursive: true });

    const adminTsconfig = {
      compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ["."],
    };
    fs.writeFileSync(
      path.join(adminDir, "tsconfig.json"),
      JSON.stringify(adminTsconfig, null, 2) + "\n"
    );

    fs.writeFileSync(
      path.join(adminDir, "vite-env.d.ts"),
      '/// <reference types="vite/client" />\n'
    );
  }

  // .gitignore
  fs.writeFileSync(
    path.join(pluginDir, ".gitignore"),
    ["node_modules/", ".medusa/", ".cache/", ".yalc/", "yalc.lock"].join("\n") +
      "\n"
  );

  success(`Scaffolded plugin at ${pluginDir}`);
  return pluginDir;
}

// ─── Step 2: Copy module files ────────────────────────────────────────────────

function copyModuleFiles(pluginDir, entry) {
  let copied = 0;
  let skipped = 0;

  for (const p of entry.paths) {
    const src = path.join(ROOT, p);
    const dest = path.join(pluginDir, p);
    if (copyPath(src, dest)) {
      copied++;
    } else {
      skipped++;
    }
  }

  success(`Copied ${copied} paths (${skipped} skipped)`);

  // Remove excluded paths (cross-module dependencies, etc.)
  if (entry.excludePaths && entry.excludePaths.length > 0) {
    let excluded = 0;
    for (const p of entry.excludePaths) {
      const dest = path.join(pluginDir, p);
      if (fs.existsSync(dest)) {
        const stat = fs.statSync(dest);
        if (stat.isDirectory()) {
          deleteDirRecursive(dest);
        } else {
          fs.unlinkSync(dest);
        }
        excluded++;
        log(`  Excluded: ${p}`);
      }
    }
    if (excluded > 0) {
      success(`Excluded ${excluded} cross-module dependency paths`);
    }
  }
}

// ─── Step 3: Copy shared admin infrastructure ─────────────────────────────────

function copySharedAdmin(pluginDir) {
  log("Copying shared admin infrastructure...");
  let copied = 0;

  for (const p of SHARED_ADMIN_FILES) {
    const src = path.join(ROOT, p);
    const dest = path.join(pluginDir, p);

    if (!fs.existsSync(src)) {
      warn(`Shared admin file not found: ${p}`);
      continue;
    }

    if (fs.existsSync(dest)) {
      // Already copied as part of module files, skip
      continue;
    }

    copyPath(src, dest);
    copied++;
  }

  success(`Copied ${copied} shared admin files`);

  // Rewrite @/ path aliases to relative imports
  rewritePathAliases(pluginDir);
}

// Rewrite @/ imports (Vite alias for src/admin/) to relative paths
function rewritePathAliases(pluginDir) {
  const adminDir = path.join(pluginDir, "src", "admin");
  if (!fs.existsSync(adminDir)) return;

  let rewritten = 0;

  function processFile(filePath) {
    let content = fs.readFileSync(filePath, "utf8");
    if (!content.includes("@/")) return;

    const fileDir = path.dirname(filePath);
    const newContent = content.replace(
      /(from\s+["'])@\/([^"']+)(["'])/g,
      (_match, prefix, importPath, suffix) => {
        // @/ maps to src/admin/, so resolve relative from file to src/admin/
        const targetAbs = path.join(adminDir, importPath);
        let rel = path.relative(fileDir, targetAbs);
        if (!rel.startsWith(".")) rel = "./" + rel;
        rewritten++;
        return `${prefix}${rel}${suffix}`;
      }
    );

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent);
    }
  }

  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        processFile(fullPath);
      }
    }
  }

  scanDir(adminDir);
  if (rewritten > 0) {
    success(`Rewrote ${rewritten} @/ path alias imports to relative paths`);
  }
}

// ─── Step 4: Generate barrel export for workflows ─────────────────────────────

function generateWorkflowBarrel(pluginDir) {
  const workflowsDir = path.join(pluginDir, "src", "workflows");
  if (!fs.existsSync(workflowsDir)) {
    log("No workflows directory found, skipping barrel export");
    return;
  }

  const exportPaths = [];

  function scanDir(dir, prefix = "") {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "index.ts") continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Check if dir has an index.ts
        if (fs.existsSync(path.join(dir, entry.name, "index.ts"))) {
          exportPaths.push({
            specifier: `./${relPath}`,
            filePath: path.join(dir, entry.name, "index.ts"),
          });
        } else {
          scanDir(path.join(dir, entry.name), relPath);
        }
      } else if (entry.name.endsWith(".ts") && !entry.name.startsWith("_")) {
        exportPaths.push({
          specifier: `./${relPath.replace(/\.ts$/, "")}`,
          filePath: path.join(dir, entry.name),
        });
      }
    }
  }

  scanDir(workflowsDir);

  if (exportPaths.length === 0) {
    log("No workflow files found for barrel export");
    return;
  }

  // Parse exported names from each file to detect duplicates
  function getExportedNames(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const names = new Set();

    // Match: export const/let/var/function/class/type/interface NAME
    const declRegex = /export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g;
    let m;
    while ((m = declRegex.exec(content)) !== null) names.add(m[1]);

    // Match: export { Name1, Name2, ... }
    const bracketRegex = /export\s*\{([^}]+)\}/g;
    while ((m = bracketRegex.exec(content)) !== null) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }

    return names;
  }

  const seenNames = new Set();
  const barrelLines = [];
  let duplicatesFound = 0;

  for (const { specifier, filePath } of exportPaths) {
    const names = getExportedNames(filePath);
    const duplicates = [...names].filter((n) => seenNames.has(n));

    if (duplicates.length === 0) {
      // No conflicts — use simple star export
      barrelLines.push(`export * from "${specifier}";`);
      for (const n of names) seenNames.add(n);
    } else {
      // Has conflicts — export only non-duplicate names
      const uniqueNames = [...names].filter((n) => !seenNames.has(n));
      if (uniqueNames.length > 0) {
        barrelLines.push(
          `export { ${uniqueNames.join(", ")} } from "${specifier}";`
        );
        for (const n of uniqueNames) seenNames.add(n);
      }
      duplicatesFound += duplicates.length;
      warn(
        `  Skipped ${duplicates.length} duplicate export(s) from ${specifier}: ${duplicates.join(", ")}`
      );
    }
  }

  fs.writeFileSync(
    path.join(workflowsDir, "index.ts"),
    barrelLines.join("\n") + "\n"
  );

  const msg = `Generated workflows/index.ts with ${exportPaths.length} modules`;
  if (duplicatesFound > 0) {
    success(`${msg} (resolved ${duplicatesFound} duplicate exports)`);
  } else {
    success(msg);
  }
}

// ─── Step 5: Generate middleware ───────────────────────────────────────────────

/**
 * Parse individual route entries from a Medusa middlewares.ts routes array.
 * Returns array of { matcher, method, raw } objects.
 */
function parseRouteEntries(content) {
  const routesIdx = content.indexOf("routes:");
  if (routesIdx === -1) return [];

  const bracketStart = content.indexOf("[", routesIdx);
  if (bracketStart === -1) return [];

  const entries = [];
  let pos = bracketStart + 1;
  let depth = 0;
  let entryStart = -1;

  while (pos < content.length) {
    const ch = content[pos];

    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      pos++;
      while (pos < content.length && content[pos] !== ch) {
        if (content[pos] === "\\") pos++;
        pos++;
      }
      pos++;
      continue;
    }

    // Skip line comments
    if (ch === "/" && pos + 1 < content.length && content[pos + 1] === "/") {
      while (pos < content.length && content[pos] !== "\n") pos++;
      pos++;
      continue;
    }

    // Skip block comments
    if (ch === "/" && pos + 1 < content.length && content[pos + 1] === "*") {
      pos += 2;
      while (
        pos < content.length - 1 &&
        !(content[pos] === "*" && content[pos + 1] === "/")
      )
        pos++;
      pos += 2;
      continue;
    }

    if (ch === "{" && depth === 0) {
      entryStart = pos;
      depth = 1;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && depth === 1) {
      depth = 0;
      const raw = content.substring(entryStart, pos + 1);
      const matcherM = raw.match(/matcher:\s*["'`]([^"'`]+)["'`]/);
      const methodM = raw.match(/method:\s*["'`]([^"'`]+)["'`]/);
      if (matcherM) {
        entries.push({
          matcher: matcherM[1],
          method: methodM ? methodM[1] : undefined,
          raw,
        });
      }
      entryStart = -1;
    } else if (ch === "}") {
      depth--;
    } else if (ch === "]" && depth === 0) {
      break;
    }

    pos++;
  }

  return entries;
}

/**
 * Scan plugin route files for multer usage patterns (req.files, Express.Multer.File).
 * Returns array of { matcher, method, diskBased } for routes needing multer middleware.
 */
function scanForMulterRoutes(pluginDir) {
  const apiDir = path.join(pluginDir, "src", "api");
  if (!fs.existsSync(apiDir)) return [];

  const routes = [];

  function scan(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scan(full);
      } else if (ent.name === "route.ts" || ent.name === "route.tsx") {
        const content = fs.readFileSync(full, "utf8");
        if (
          !content.includes("req.files") &&
          !content.includes("Express.Multer") &&
          !content.includes("Multer.File")
        )
          continue;

        // Detect exported HTTP methods
        const methods = [];
        if (/export\s+(const|async\s+function)\s+POST\b/.test(content))
          methods.push("POST");
        if (/export\s+(const|async\s+function)\s+PUT\b/.test(content))
          methods.push("PUT");
        if (/export\s+(const|async\s+function)\s+PATCH\b/.test(content))
          methods.push("PATCH");
        if (methods.length === 0) methods.push("POST");

        // Convert file path to route matcher
        const rel = path.relative(path.join(pluginDir, "src", "api"), dir);
        const matcher =
          "/" +
          rel
            .split(path.sep)
            .join("/")
            .replace(/\[([^\]]+)\]/g, ":$1");

        for (const method of methods) {
          routes.push({ matcher, method, diskBased: true });
        }
      }
    }
  }

  scan(apiDir);
  return routes;
}

/**
 * Extract the contents of the middlewares array from a raw route entry.
 * Handles nested brackets (e.g., authenticate("x", ["session", "bearer"])).
 */
function extractMiddlewaresContent(raw) {
  const idx = raw.indexOf("middlewares:");
  if (idx === -1) return "";

  const bracketStart = raw.indexOf("[", idx);
  if (bracketStart === -1) return "";

  let depth = 1;
  let pos = bracketStart + 1;

  while (pos < raw.length && depth > 0) {
    const ch = raw[pos];
    if (ch === '"' || ch === "'" || ch === "`") {
      pos++;
      while (pos < raw.length && raw[pos] !== ch) {
        if (raw[pos] === "\\") pos++;
        pos++;
      }
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
    }
    pos++;
  }

  return raw
    .substring(bracketStart + 1, pos - 1)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,\s*$/, "");
}

/**
 * Generate src/api/middlewares.ts for the plugin.
 * Combines matched entries from main app's middlewares + auto-detected multer routes.
 */
function generateMiddleware(pluginDir, entry) {
  const apiDirPaths = entry.paths.filter(
    (p) => p.startsWith("src/api/") && !p.match(/\.(ts|tsx)$/)
  );

  if (apiDirPaths.length === 0) {
    log("No API route directories, skipping middleware generation");
    return;
  }

  const routePrefixes = apiDirPaths.map(
    (p) => "/" + p.replace(/^src\/api\//, "")
  );
  const excludedPrefixes = (entry.excludePaths || [])
    .filter((p) => p.startsWith("src/api/"))
    .map((p) => "/" + p.replace(/^src\/api\//, ""));

  // ── Phase A: Match entries from main app's middlewares.ts ──
  const mainMwPath = path.join(ROOT, "src", "api", "middlewares.ts");
  let matchedMainEntries = [];
  let mainContent = "";

  if (fs.existsSync(mainMwPath)) {
    mainContent = fs.readFileSync(mainMwPath, "utf8");
    const allEntries = parseRouteEntries(mainContent);

    matchedMainEntries = allEntries.filter((re) => {
      const m = re.matcher;
      const matches = routePrefixes.some(
        (pfx) =>
          m === pfx || m.startsWith(pfx + "/") || m.startsWith(pfx + ":")
      );
      if (!matches) return false;
      return !excludedPrefixes.some(
        (pfx) =>
          m === pfx || m.startsWith(pfx + "/") || m.startsWith(pfx + ":")
      );
    });
  }

  // ── Phase B: Scan plugin route files for multer patterns ──
  const multerRoutes = scanForMulterRoutes(pluginDir);
  const mainKeys = new Set(
    matchedMainEntries.map((e) => `${e.matcher}|${e.method || "*"}`)
  );
  const extraMulterRoutes = multerRoutes.filter(
    (r) => !mainKeys.has(`${r.matcher}|${r.method}`)
  );

  // ── Analyze matched entries ──
  const allRaw = matchedMainEntries.map((e) => e.raw).join("\n");
  const needsValidateBody = allRaw.includes("validateAndTransformBody");
  const needsValidateQuery = allRaw.includes("validateAndTransformQuery");
  const needsAuth = allRaw.includes("authenticate");
  const needsCors =
    allRaw.includes("createCorsMiddleware") ||
    allRaw.includes("createCorsPartnerMiddleware");

  // ── Collect validator schemas and find their imports ──
  const schemaNames = new Set();
  const schemaRe = /wrapSchema\((\w+)\)/g;
  let schemaMatch;
  while ((schemaMatch = schemaRe.exec(allRaw)) !== null)
    schemaNames.add(schemaMatch[1]);

  const validatorImports = [];
  const availableSchemas = new Set();

  if (schemaNames.size > 0 && mainContent) {
    const importLines = mainContent
      .split("\n")
      .filter((l) => l.trim().startsWith("import "));

    for (const importLine of importLines) {
      const refs = [...schemaNames].filter((s) => importLine.includes(s));
      if (refs.length === 0) continue;

      const srcMatch = importLine.match(/from\s+["']([^"']+)["']/);
      if (!srcMatch || !srcMatch[1].startsWith("./")) continue;

      const resolvedBase = path.join(pluginDir, "src", "api", srcMatch[1]);
      if (
        fs.existsSync(resolvedBase + ".ts") ||
        fs.existsSync(resolvedBase + ".tsx") ||
        fs.existsSync(resolvedBase + "/index.ts") ||
        fs.existsSync(resolvedBase)
      ) {
        validatorImports.push(importLine.trim());
        for (const s of refs) availableSchemas.add(s);
      }
    }
  }

  // Filter out entries referencing unavailable schemas
  const validEntries = matchedMainEntries.filter((e) => {
    const refs = [];
    const re = /wrapSchema\((\w+)\)/g;
    let m;
    while ((m = re.exec(e.raw)) !== null) refs.push(m[1]);
    return refs.every((s) => availableSchemas.has(s));
  });

  if (validEntries.length === 0 && extraMulterRoutes.length === 0) {
    log("No middleware entries needed for this plugin");
    return;
  }

  // ── Determine multer needs ──
  const validRaw = validEntries.map((e) => e.raw).join("\n");
  const genMaybeMulter = /\bmaybeMulterArray\(/.test(validRaw);
  const genMaybeMediaMulter =
    validRaw.includes("maybeMediaMulterArray") || extraMulterRoutes.length > 0;
  const genAdaptMulter = validRaw.includes("adaptMulter");
  const needsMulter = genMaybeMulter || genMaybeMediaMulter || genAdaptMulter;
  const needsMemoryMulter = genMaybeMulter || genAdaptMulter;
  const needsDiskMulter = genMaybeMediaMulter;
  const hasValidation = availableSchemas.size > 0;

  // ── Build the middleware file ──
  const out = [];

  // Framework imports
  const fw = ["defineMiddlewares"];
  if (needsValidateBody && hasValidation) fw.push("validateAndTransformBody");
  if (needsValidateQuery && hasValidation)
    fw.push("validateAndTransformQuery");
  if (needsAuth) fw.push("authenticate");
  if (needsMulter || needsCors)
    fw.push(
      "type MedusaNextFunction",
      "type MedusaRequest",
      "type MedusaResponse"
    );
  out.push(
    `import {\n  ${fw.join(",\n  ")},\n} from "@medusajs/framework/http";`
  );

  if (needsMulter) out.push('import multer from "multer";');
  if (needsDiskMulter) {
    out.push('import os from "os";');
    out.push('import path from "path";');
  }
  if (needsCors) {
    out.push(
      'import { parseCorsOrigins } from "@medusajs/framework/utils";'
    );
    out.push('import cors from "cors";');
  }
  if (hasValidation) out.push('import { z } from "zod";');

  // Validator imports
  if (validatorImports.length > 0) {
    out.push("");
    for (const vi of [...new Set(validatorImports)]) out.push(vi);
  }

  out.push("");

  // Helper: wrapSchema
  if (hasValidation) {
    out.push("const wrapSchema = <T extends z.ZodType>(schema: T) => {");
    out.push("  return z.preprocess((obj) => obj, schema) as any;");
    out.push("};");
    out.push("");
  }

  // Helper: CORS
  if (validRaw.includes("createCorsMiddleware")) {
    out.push(
      [
        "const createCorsMiddleware = (corsOptions?: any) => {",
        "  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {",
        "    const defaultOptions = {",
        '      origin: parseCorsOrigins(process.env.WEB_CORS as string),',
        "      credentials: true,",
        "    };",
        "    return cors({ ...defaultOptions, ...corsOptions })(req, res, next);",
        "  };",
        "};",
      ].join("\n")
    );
    out.push("");
  }
  if (validRaw.includes("createCorsPartnerMiddleware")) {
    out.push(
      [
        "const createCorsPartnerMiddleware = (corsOptions?: any) => {",
        "  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {",
        '    const origins = process.env.PARTNER_CORS || process.env.AUTH_CORS || process.env.ADMIN_CORS || process.env.WEB_CORS || "";',
        "    const defaultOptions = {",
        "      origin: parseCorsOrigins(origins),",
        "      credentials: true,",
        "    };",
        "    return cors({ ...defaultOptions, ...corsOptions })(req, res, next);",
        "  };",
        "};",
      ].join("\n")
    );
    out.push("");
  }

  // Multer setup
  if (needsMemoryMulter) {
    out.push(
      "const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });"
    );
    out.push("");
  }
  if (needsDiskMulter) {
    out.push(
      [
        "const mediaUpload = multer({",
        "  storage: multer.diskStorage({",
        "    destination: (_req, _file, cb) => cb(null, os.tmpdir()),",
        "    filename: (_req, file, cb) => {",
        '      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);',
        "      const ext = path.extname(file.originalname);",
        "      cb(null, `${unique}${ext}`);",
        "    },",
        "  }),",
        "  limits: { fileSize: 2 * 1024 * 1024 * 1024 },",
        "});",
      ].join("\n")
    );
    out.push("");
  }

  // Multer wrapper functions
  const multerFnCode = (fnName, varName) =>
    [
      `const ${fnName} = (field: string) => {`,
      "  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {",
      '    const ct = String(req.headers["content-type"] || "").toLowerCase();',
      '    if (!ct.startsWith("multipart/form-data")) {',
      "      (req as any).files = [];",
      "      return next();",
      "    }",
      `    const handler = ${varName}.array(field);`,
      "    handler(req as any, res as any, (err?: any) => {",
      "      if (err) {",
      '        const msg = String(err?.message || "");',
      '        if (msg.includes("Unexpected end of form")) {',
      "          (req as any).files = [];",
      "          return next();",
      "        }",
      "        return next(err);",
      "      }",
      "      return next();",
      "    });",
      "  };",
      "};",
    ].join("\n");

  if (genMaybeMulter) {
    out.push(multerFnCode("maybeMulterArray", "upload"));
    out.push("");
  }
  if (genMaybeMediaMulter) {
    out.push(multerFnCode("maybeMediaMulterArray", "mediaUpload"));
    out.push("");
  }
  if (genAdaptMulter) {
    out.push(
      [
        "const adaptMulter = (multerMiddleware: any) => {",
        "  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {",
        "    return multerMiddleware(req as any, res as any, (err: any) => next(err));",
        "  };",
        "};",
      ].join("\n")
    );
    out.push("");
  }

  // Routes array
  out.push("export default defineMiddlewares({");
  out.push("  routes: [");

  // Deduplicate entries by matcher+method (main app may have duplicates)
  const seenRoutes = new Set();
  const deduped = validEntries.filter((e) => {
    const key = `${e.matcher}|${e.method || "*"}`;
    if (seenRoutes.has(key)) return false;
    seenRoutes.add(key);
    return true;
  });

  // Matched main entries (reconstructed for clean formatting)
  for (const e of deduped) {
    out.push("    {");
    out.push(`      matcher: "${e.matcher}",`);
    if (e.method) out.push(`      method: "${e.method}",`);

    const mwContent = extractMiddlewaresContent(e.raw);
    if (mwContent) {
      out.push(`      middlewares: [${mwContent}],`);
    } else {
      out.push("      middlewares: [],");
    }

    // Preserve bodyParser setting if present
    const bpMatch = e.raw.match(/bodyParser:\s*(true|false)/);
    if (bpMatch) out.push(`      bodyParser: ${bpMatch[1]},`);

    out.push("    },");
  }

  // Auto-detected multer routes
  for (const r of extraMulterRoutes) {
    const fn = r.diskBased ? "maybeMediaMulterArray" : "maybeMulterArray";
    out.push("    {");
    out.push(`      matcher: "${r.matcher}",`);
    out.push(`      method: "${r.method}",`);
    out.push(`      middlewares: [${fn}("files")],`);
    out.push("    },");
  }

  out.push("  ],");
  out.push("});");
  out.push("");

  // Write the file
  const mwPath = path.join(pluginDir, "src", "api", "middlewares.ts");
  fs.mkdirSync(path.dirname(mwPath), { recursive: true });
  fs.writeFileSync(mwPath, out.join("\n"));

  const dedupedSkipped = validEntries.length - deduped.length;
  const dedupMsg = dedupedSkipped > 0 ? `, ${dedupedSkipped} duplicates removed` : "";
  success(
    `Generated middlewares.ts (${deduped.length} from main app + ${extraMulterRoutes.length} auto-detected multer routes${dedupMsg})`
  );
}

// ─── Step 6: Auto-detect third-party dependencies ─────────────────────────────

function detectDependencies(pluginDir, entry) {
  const rootDeps = readRootDependencies();
  const detectedDeps = new Map();
  const detectedDevDeps = new Map();

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");

    // Match import statements and require calls
    const importRegex =
      /(?:import\s+.*?\s+from\s+["']|import\s+["']|require\s*\(\s*["'])([^"'.][^"']*?)["']/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      let pkg = match[1];

      // Skip relative imports and path aliases (@/ is Vite alias for src/admin/)
      if (pkg.startsWith(".") || pkg.startsWith("/") || pkg.startsWith("@/")) continue;

      // Get package name (handle scoped packages)
      if (pkg.startsWith("@")) {
        const parts = pkg.split("/");
        pkg = parts.slice(0, 2).join("/");
      } else {
        pkg = pkg.split("/")[0];
      }

      // Skip Node built-ins
      if (
        [
          "fs",
          "path",
          "os",
          "url",
          "util",
          "crypto",
          "http",
          "https",
          "stream",
          "events",
          "child_process",
          "buffer",
          "querystring",
          "net",
          "tls",
          "zlib",
          "assert",
        ].includes(pkg)
      )
        continue;

      // Skip packages already in devDependencies/peerDependencies
      if (MEDUSA_DEV_PACKAGES.has(pkg)) continue;

      // Skip explicitly excluded packages
      if (EXCLUDED_PACKAGES.has(pkg)) continue;

      // Resolve version: root deps → fallback → "*"
      const resolveVersion = (p) =>
        rootDeps[p] || FALLBACK_VERSIONS[p] || "*";

      // Categorize: admin-only packages → devDeps, others → deps
      const isAdminFile =
        filePath.includes("/src/admin/") ||
        filePath.includes("\\src\\admin\\");
      const isAdminOnlyPkg = [
        "react",
        "react-dom",
        "react-router-dom",
        "@tanstack/react-query",
        "@tanstack/react-table",
        "react-hook-form",
        "@hookform/resolvers",
        "react-i18next",
        "@radix-ui/react-label",
        "@radix-ui/react-slot",
        "prop-types",
        "clsx",
        "tailwind-merge",
        "lucide-react",
        "framer-motion",
      ].includes(pkg);

      if (isAdminFile && isAdminOnlyPkg) {
        if (!detectedDevDeps.has(pkg)) {
          detectedDevDeps.set(pkg, resolveVersion(pkg));
        }
      } else if (!isAdminOnlyPkg || !isAdminFile) {
        if (!detectedDeps.has(pkg)) {
          detectedDeps.set(pkg, resolveVersion(pkg));
        }
      }
    }
  }

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".medusa") continue;
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        scanFile(fullPath);
      }
    }
  }

  scanDir(path.join(pluginDir, "src"));

  // Merge detected deps with extraDeps from config
  const finalDeps = { ...Object.fromEntries(detectedDeps) };
  if (entry.extraDeps) {
    Object.assign(finalDeps, entry.extraDeps);
  }

  // Remove deps that belong in devDependencies
  for (const pkg of Object.keys(ADMIN_DEV_DEPS)) {
    delete finalDeps[pkg];
  }

  // Update package.json
  const pkgPath = path.join(pluginDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  // Merge runtime dependencies (existing template versions take precedence)
  for (const [dep, ver] of Object.entries(finalDeps)) {
    if (!pkg.dependencies[dep]) {
      pkg.dependencies[dep] = ver;
    }
  }

  // Merge detected dev deps (existing template versions take precedence)
  for (const [dep, ver] of detectedDevDeps.entries()) {
    if (!pkg.devDependencies[dep]) {
      pkg.devDependencies[dep] = ver;
    }
  }

  // Add @types packages for detected deps
  const typesNeeded = {
    lodash: "@types/lodash",
    validator: "@types/validator",
    multer: "@types/multer",
  };
  for (const [dep, typesPkg] of Object.entries(typesNeeded)) {
    if (pkg.dependencies[dep] || detectedDeps.has(dep)) {
      const typesVer = rootDeps[typesPkg] || FALLBACK_VERSIONS[typesPkg];
      if (typesVer) {
        pkg.devDependencies[typesPkg] = typesVer;
      }
    }
  }

  // Always add @types/multer for plugins with file upload API routes (Express.Multer.File)
  if (!pkg.devDependencies["@types/multer"]) {
    const srcDir = path.join(pluginDir, "src");
    let needsMulterTypes = false;
    function checkForMulterType(dir) {
      if (!fs.existsSync(dir) || needsMulterTypes) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (needsMulterTypes) return;
        const fp = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".medusa") {
          checkForMulterType(fp);
        } else if (/\.(ts|tsx)$/.test(e.name)) {
          const c = fs.readFileSync(fp, "utf8");
          if (c.includes("Express.Multer") || c.includes("Multer.File")) {
            needsMulterTypes = true;
          }
        }
      }
    }
    checkForMulterType(srcDir);
    if (needsMulterTypes) {
      pkg.devDependencies["@types/multer"] = FALLBACK_VERSIONS["@types/multer"] || "^1.4.12";
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const depCount = Object.keys(finalDeps).length;
  success(
    `Detected ${depCount} runtime dependencies, ${detectedDevDeps.size} extra dev dependencies`
  );

  if (depCount > 0) {
    log("  Runtime deps: " + Object.keys(finalDeps).join(", "));
  }
}

// ─── Step 7: Install, build, publish ──────────────────────────────────────────

function installBuildPublish(pluginDir) {
  const name = path.basename(pluginDir);

  log("Installing dependencies...");
  execSync("yarn install", {
    cwd: pluginDir,
    stdio: "inherit",
  });
  success("Dependencies installed");

  log("Building plugin...");
  execSync("yarn build", {
    cwd: pluginDir,
    stdio: "inherit",
  });
  success("Plugin built successfully");

  log("Publishing via yalc...");
  execSync("npx yalc publish", {
    cwd: pluginDir,
    stdio: "inherit",
  });
  success(`Published ${name} via yalc`);
}

// ─── Step 8: Update main app (--delete-originals) ────────────────────────────

function updateMainApp(moduleName, entry) {
  log("Updating main app...");

  // Delete original source files
  for (const p of entry.paths) {
    const fullPath = path.join(ROOT, p);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        deleteDirRecursive(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
      log(`  Deleted: ${p}`);
    }
  }

  // Update medusa-config.ts
  const configPath = path.join(ROOT, "medusa-config.ts");
  let config = fs.readFileSync(configPath, "utf8");

  // Remove module entry from modules array
  const resolveStr = entry.moduleConfigResolve;
  // Match patterns like: { resolve: "./src/modules/xxx" }, or with options
  const modulePatterns = [
    // Simple: { resolve: "./src/modules/xxx" },
    new RegExp(
      `\\s*\\{[\\s\\S]*?resolve:\\s*["']${escapeRegExp(resolveStr)}["'][\\s\\S]*?\\},?\\n?`,
      "g"
    ),
  ];

  for (const pattern of modulePatterns) {
    config = config.replace(pattern, "");
  }

  // Add to plugins array if not already there
  if (!config.includes(entry.pluginName)) {
    config = config.replace(
      /plugins:\s*\[/,
      `plugins: [\n    {\n      resolve: "${entry.pluginName}",\n      options: {},\n    },`
    );
  }

  fs.writeFileSync(configPath, config);
  success("Updated medusa-config.ts");

  // Add plugin via yalc
  log("Adding plugin to main app via yalc...");
  execSync(`npx yalc add ${entry.pluginName} --no-pure`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  success(`Added ${entry.pluginName} to main app`);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
\x1b[1mextract-plugin.mjs\x1b[0m — Extract JYT modules into standalone Medusa plugins

\x1b[1mUsage:\x1b[0m
  node scripts/extract-plugin.mjs <module-name> [options]
  node scripts/extract-plugin.mjs --list

\x1b[1mOptions:\x1b[0m
  --list               List all extractable modules
  --skip-build         Scaffold only, skip build + publish
  --delete-originals   Remove originals from main app after extraction
  --help               Show this help message

\x1b[1mExamples:\x1b[0m
  node scripts/extract-plugin.mjs media
  node scripts/extract-plugin.mjs media --skip-build
  node scripts/extract-plugin.mjs media --delete-originals
`);
}

function listModules(config) {
  console.log("\n\x1b[1mExtractable modules:\x1b[0m\n");

  const entries = Object.entries(config);
  const maxName = Math.max(...entries.map(([n]) => n.length));
  const maxPlugin = Math.max(...entries.map(([, e]) => e.pluginName.length));

  console.log(
    "  " +
      "Module".padEnd(maxName + 2) +
      "Plugin".padEnd(maxPlugin + 2) +
      "Admin UI  " +
      "Paths"
  );
  console.log("  " + "─".repeat(maxName + maxPlugin + 24));

  for (const [name, entry] of entries) {
    const adminUI = entry.hasAdminUI ? "Yes" : "No";
    console.log(
      "  " +
        name.padEnd(maxName + 2) +
        entry.pluginName.padEnd(maxPlugin + 2) +
        adminUI.padEnd(10) +
        entry.paths.length
    );
  }

  console.log(`\n  Total: ${entries.length} modules\n`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const config = loadConfig();

  if (args.includes("--list")) {
    listModules(config);
    process.exit(0);
  }

  const moduleName = args.find((a) => !a.startsWith("--"));
  const skipBuild = args.includes("--skip-build");
  const deleteOriginals = args.includes("--delete-originals");

  if (!moduleName) {
    error("No module name provided");
    printUsage();
    process.exit(1);
  }

  if (!config[moduleName]) {
    error(`Unknown module: ${moduleName}`);
    console.log(
      "Available modules: " + Object.keys(config).join(", ")
    );
    process.exit(1);
  }

  const entry = config[moduleName];
  const medusaVersion = readMedusaVersion();

  console.log(`\n\x1b[1m🔧 Extracting ${entry.pluginName}\x1b[0m`);
  console.log(`   Medusa version: ${medusaVersion}`);
  console.log(`   Admin UI: ${entry.hasAdminUI ? "Yes" : "No"}`);
  console.log(`   Paths: ${entry.paths.length}`);
  console.log("");

  // Step 1: Scaffold
  log("Step 1/7: Scaffolding plugin...");
  const pluginDir = scaffoldPlugin(moduleName, entry, medusaVersion);

  // Step 2: Copy module files
  log("Step 2/7: Copying module files...");
  copyModuleFiles(pluginDir, entry);

  // Step 3: Copy shared admin infrastructure
  if (entry.hasAdminUI) {
    log("Step 3/7: Copying shared admin infrastructure...");
    copySharedAdmin(pluginDir);
  } else {
    log("Step 3/7: Skipping shared admin (no admin UI)");
  }

  // Step 4: Generate workflow barrel export
  log("Step 4/7: Generating workflow barrel export...");
  generateWorkflowBarrel(pluginDir);

  // Step 5: Generate middleware
  log("Step 5/7: Generating middleware...");
  generateMiddleware(pluginDir, entry);

  // Step 6: Auto-detect dependencies
  log("Step 6/7: Detecting third-party dependencies...");
  detectDependencies(pluginDir, entry);

  // Step 7: Build & publish
  if (skipBuild) {
    log("Step 7/7: Skipping build (--skip-build)");
  } else {
    log("Step 7/7: Installing, building, and publishing...");
    try {
      installBuildPublish(pluginDir);
    } catch (e) {
      error(`Build failed: ${e.message}`);
      warn("Plugin was scaffolded at: " + pluginDir);
      warn("Fix build errors and run: cd " + pluginDir + " && yarn build");
      process.exit(1);
    }
  }

  // Optional: Delete originals
  if (deleteOriginals) {
    log("Updating main app (--delete-originals)...");
    updateMainApp(moduleName, entry);
  }

  console.log("");
  success(`Plugin extracted to: ${pluginDir}`);

  if (!skipBuild) {
    console.log(`\n\x1b[1mNext steps:\x1b[0m`);
    if (!deleteOriginals) {
      console.log(
        `  1. Test the plugin: npx yalc add ${entry.pluginName} --no-pure`
      );
      console.log(
        `  2. Register in medusa-config.ts plugins array`
      );
      console.log(
        `  3. Remove the original module from modules array`
      );
      console.log(`  4. Run: yarn dev`);
    } else {
      console.log(`  1. Run: yarn install`);
      console.log(`  2. Run: yarn dev`);
    }
  } else {
    console.log(`\n\x1b[1mNext steps:\x1b[0m`);
    console.log(`  1. cd ${pluginDir}`);
    console.log(`  2. Review and adjust files as needed`);
    console.log(`  3. yarn install && yarn build`);
    console.log(`  4. npx yalc publish`);
  }

  console.log("");
}

main();
