#!/usr/bin/env node

/**
 * Deployment script for Railway
 * 
 * This script helps prepare your Medusa application for deployment to Railway.
 * It can be used both locally and in CI/CD environments like GitHub Actions.
 * 
 * Usage:
 *   node deploy-railway.js --mode=[server|worker] [--ci]
 * 
 * Options:
 *   --mode=server|worker   Specify which mode to deploy (server or worker)
 *   --ci                   Run in CI mode (non-interactive, no prompts)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2);
const modeArg = args.find(arg => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'server';
const ciMode = args.includes('--ci');
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// If running in GitHub Actions, force CI mode
const isNonInteractive = ciMode || isGitHubActions;

if (!['server', 'worker'].includes(mode)) {
  console.error('Error: Mode must be either "server" or "worker"');
  process.exit(1);
}

console.log(`Preparing deployment for ${mode} mode${isNonInteractive ? ' (CI mode)' : ''}...`);

// Function to generate a secure random string
function generateSecureSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Define the configPath and backupPath early so they're available in all functions
const configPath = path.join(process.cwd(), 'medusa-config.ts');
const backupPath = path.join(process.cwd(), 'medusa-config.dev.ts');

// Define restore function before using it
function restoreDevConfig() {
  try {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, configPath);
      console.log('✅ Development configuration restored');
    }
  } catch (error) {
    console.error('Error restoring development configuration:', error.message);
    process.exit(1);
  }
}

// In GitHub Actions, medusa-config.ts is already replaced before this script runs
if (isGitHubActions) {
  console.log('Running in GitHub Actions - skipping configuration replacement');
} else {
  // Step 1: Backup current medusa-config.ts
  console.log('Backing up current configuration...');

  try {
    fs.copyFileSync(configPath, backupPath);
    console.log('✅ Configuration backed up to medusa-config.dev.ts');
  } catch (error) {
    console.error('Error backing up configuration:', error.message);
    process.exit(1);
  }

  // Step 2: Copy production config to medusa-config.ts
  console.log('Setting up production configuration...');
  const prodConfigPath = path.join(process.cwd(), 'medusa-config.prod.ts');

  try {
    if (!fs.existsSync(prodConfigPath)) {
      console.error('Error: Production configuration file not found at', prodConfigPath);
      restoreDevConfig();
      process.exit(1);
    }
    
    fs.copyFileSync(prodConfigPath, configPath);
    console.log('✅ Production configuration copied to medusa-config.ts');
    
    // Build Medusa with production config to ensure .medusa/server uses the correct config
    console.log('Building Medusa with production config...');
    try {
      execSync('yarn medusa build', { stdio: 'inherit' });
      console.log('✅ Medusa built successfully with production config');
      
      // Handle the compiled config in .medusa/server directory
      const medusaServerDir = path.join(process.cwd(), '.medusa', 'server');
      const medusaServerConfigPath = path.join(medusaServerDir, 'medusa-config.js');
      if (fs.existsSync(medusaServerDir)) {
        // Find any existing production config that might have been compiled
        const compiledProdConfigPath = path.join(medusaServerDir, 'medusa-config.prod.js');
        
        if (fs.existsSync(compiledProdConfigPath)) {
          // Use the compiled production config if it exists
          console.log('Found compiled production config in .medusa/server directory...');
          fs.copyFileSync(compiledProdConfigPath, medusaServerConfigPath);
          console.log('✅ Compiled production configuration copied to .medusa/server/medusa-config.js');
        } else {
          // Create a temporary JavaScript version of the production config
          console.log('Creating JavaScript version of production config for .medusa/server...');
          try {
            const tsContent = fs.readFileSync(prodConfigPath, 'utf8');
            // Basic TypeScript to JavaScript conversion (replaces 'export default' with 'module.exports =')
            const jsContent = tsContent
              .replace(/export\s+default\s*{/, 'module.exports = {')
              .replace(/import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"];?/g, 'const { $1 } = require("$2");');
            
            fs.writeFileSync(medusaServerConfigPath, jsContent);
            console.log('✅ JavaScript version of production config created at .medusa/server/medusa-config.js');
          } catch (error) {
            console.error('Error creating JavaScript version of production config:', error.message);
            console.log('⚠️ Using default config in .medusa/server');
          }
        }
      } else {
        console.log('⚠️ .medusa/server directory not found, skipping server config update');
      }
    } catch (buildError) {
      console.error('Error building Medusa:', buildError.message);
      // Continue even if build fails since Railway will build it again
    }
  } catch (error) {
    console.error('Error copying production configuration:', error.message);
    // Restore backup
    restoreDevConfig();
    process.exit(1);
  }
}

// Step 3: Ensure predeploy script exists in package.json
console.log('Checking package.json scripts...');
const packageJsonPath = path.join(process.cwd(), 'package.json');
let packageJson;

try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (!packageJson.scripts.predeploy) {
    packageJson.scripts.predeploy = 'medusa db:migrate';
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Added predeploy script to package.json');
  } else {
    console.log('✅ predeploy script already exists in package.json');
  }
} catch (error) {
  console.error('Error modifying package.json:', error.message);
  restoreDevConfig();
  process.exit(1);
}

// Step 4: Generate environment variables template
console.log('Generating environment variables template...');

// Generate secrets
const cookieSecret = generateSecureSecret();
const jwtSecret = generateSecureSecret();

const serverEnvVars = `# Required variables - set these in Railway
COOKIE_SECRET=
JWT_SECRET=
STORE_CORS=
ADMIN_CORS=
AUTH_CORS=
DISABLE_MEDUSA_ADMIN=false
MEDUSA_WORKER_MODE=server
PORT=9000
DATABASE_URL=\${Postgres.DATABASE_URL}
REDIS_URL=\${Redis.REDIS_URL}?family=0
MEDUSA_BACKEND_URL=

# S3 Config - set these in Railway for file storage
S3_FILE_URL=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=
S3_BUCKET=
S3_ENDPOINT=`;

const workerEnvVars = `# Required variables - set these in Railway
COOKIE_SECRET=
JWT_SECRET=
DISABLE_MEDUSA_ADMIN=true
MEDUSA_WORKER_MODE=worker
PORT=9000
DATABASE_URL=\${Postgres.DATABASE_URL}
REDIS_URL=\${Redis.REDIS_URL}?family=0

# S3 Config - set these in Railway for file storage
S3_FILE_URL=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=
S3_BUCKET=
S3_ENDPOINT=`;

const envVars = mode === 'server' ? serverEnvVars : workerEnvVars;
const envFilePath = path.join(process.cwd(), `.env.railway.${mode}`);

try {
  fs.writeFileSync(envFilePath, envVars);
  console.log(`✅ Environment variables template created at .env.railway.${mode}`);
  console.log('⚠️ For security, environment variables are empty. Set actual values in Railway dashboard.');
} catch (error) {
  console.error('Error writing environment variables template:', error.message);
  restoreDevConfig();
  process.exit(1);
}

// Step 5: Generate custom start commands
console.log('Generating deployment commands...');

const serverStartCommand = 'cd .medusa/server && yarn install && yarn predeploy && yarn run start';
const workerStartCommand = 'cd .medusa/server && yarn install && yarn predeploy && yarn run start';
const startCommand = mode === 'server' ? serverStartCommand : workerStartCommand;

console.log('\n✅ Deployment preparation complete!');
console.log('\n======================= DEPLOYMENT INSTRUCTIONS =======================');
console.log('\nRailway Environment Variables:');
console.log(`Use the content of .env.railway.${mode} in Railway's Raw Editor.`);
console.log(`Try running: cat .env.railway.${mode}`);
console.log('\nCustom Start Command for Railway:');
console.log(startCommand);
console.log('\nMake sure to update the placeholder values with your actual values before deployment.');
console.log('======================================================================\n');

// Step 6: If requested, restore development config
const restorePrompt = `Would you like to restore your development configuration now? (y/n): `;

// In GitHub Actions or CI mode, we don't restore the dev config
// as we want to keep the production config for deployment
if (isNonInteractive) {
  console.log('Running in CI mode - keeping production configuration for deployment');
  
  // We're now using railway.json instead of the older TOML format
  
  console.log('✅ Deployment preparation complete!');
  process.exit(0);
} else {
  // Interactive environment - ask if user wants to restore
  process.stdout.write(restorePrompt);
  
  // Set up safer input handling with timeout
  const stdin = process.stdin;
  stdin.setEncoding('utf8');
  stdin.resume();
  
  let userInput = '';
  
  stdin.on('data', (data) => {
    userInput += data;
    
    if (userInput.includes('\n')) {
      const answer = userInput.trim().toLowerCase();
      
      if (answer === 'y' || answer === 'yes') {
        restoreDevConfig();
      } else {
        console.log('Development configuration will remain backed up at medusa-config.dev.ts');
        console.log('To restore it manually, rename it back to medusa-config.ts');
      }
      
      stdin.pause();
      process.exit(0);
    }
  });
  
  // Add a timeout in case user doesn't respond
  setTimeout(() => {
    console.log('\nNo input received, keeping production configuration.');
    console.log('Development configuration is backed up at medusa-config.dev.ts');
    console.log('To restore it manually, rename it back to medusa-config.ts');
    process.exit(0);
  }, 30000); // 30 second timeout
}
