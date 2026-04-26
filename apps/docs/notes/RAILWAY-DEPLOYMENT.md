# Railway Deployment Guide for Medusa

This guide helps you set up automated deployments for your Medusa application to Railway using GitHub Actions.

## Deployment Configuration

This repository includes:

1. `medusa-config.prod.ts` - Production-ready configuration for Railway
2. `deploy-railway.js` - Script to prepare your application for deployment
3. `.github/workflows/deploy-to-railway.yml` - GitHub Actions workflow for automated deployment

## One-Time Setup

### 1. Set up Railway Project

1. Create a Railway account at [railway.app](https://railway.app/)
2. Create a new project 
3. Add a PostgreSQL database service
4. Add a Redis service
5. Create two empty services for your Medusa application:
   - `medusa-server` - For the server mode
   - `medusa-worker` - For the worker mode

### 2. Set up GitHub Secrets

You need to add one secret to your GitHub repository:

`RAILWAY_TOKEN` - Your Railway Project Token

To generate a Project Token:
1. Go to your Railway project
2. Navigate to Settings > Tokens
3. Click "+ New Token"
4. Name your token (e.g., "GitHub Actions")
5. Copy the generated token

To add this secret to your GitHub repository:
1. Go to your repository settings
2. Navigate to Secrets and variables > Actions
3. Click "New repository secret"
4. Name it `RAILWAY_TOKEN` and paste the value
5. Click "Add secret"

## How It Works

When you push to your main branch, the GitHub Actions workflow:

1. Runs in Railway's official CLI container, providing direct access to Railway commands

2. First replaces medusa-config.ts with the production version

3. Then uses the deploy-railway.js script to:
   - Generate environment variable templates
   - Create Railway configuration files
   
3. Deploys the server to Railway using `railway up --service=medusa-server --detach`

4. After server deployment completes, prepares and deploys the worker application
   
This approach uses Railway's recommended container-based deployment method for the most reliable integration.

## Manual Deployment

If you want to deploy manually:

```bash
# Copy production config to medusa-config.ts first
cp medusa-config.prod.ts medusa-config.ts

# For server mode
node deploy-railway.js --mode=server --ci

# For worker mode
node deploy-railway.js --mode=worker --ci
```

Then use the Railway CLI to deploy:

```bash
# Install Railway CLI if you haven't already
npm install -g @railway/cli

# Login to Railway
railway login

# Generate a project token from Railway dashboard
# Settings > Tokens > New Token

# Use your project token
export RAILWAY_TOKEN=your-project-token

# Deploy server mode
railway up --service medusa-server --detach

# Deploy worker mode
railway up --service medusa-worker --detach
```

## Environment Variables

The deployment script creates template environment variable files:
- `.env.railway.server` - For server mode
- `.env.railway.worker` - For worker mode

**Important:** Before your first deployment, you must:

1. Copy the environment variables from these files
2. Go to your services on Railway
3. Add them in the "Variables" tab using the Raw Editor

## Creating Admin User

To create an admin user after deployment:

```bash
railway run -s medusa-server "npx medusa user -e your-email@example.com -p your-password"
```

Replace `your-email@example.com` and `your-password` with your desired credentials.

## Troubleshooting

If you encounter issues:

1. Check the GitHub Actions logs
2. Check Railway logs for both services
3. Ensure your environment variables are set correctly
4. Verify your database connections

For more details, refer to the [Medusa Railway deployment documentation](https://docs.medusajs.com/deployments/server/railway).
