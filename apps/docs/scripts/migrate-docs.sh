#!/bin/bash
# migrate-docs.sh - One-time migration of flat docs/ to organized Docusaurus structure
# Run from monorepo root: bash apps/docs/scripts/migrate-docs.sh

set -e

SOURCE="./docs"
TARGET="./apps/docs/docs"

# Helper: migrate a file with front-matter
migrate() {
  local src="$1"
  local dest_dir="$2"
  local dest_name="$3"
  local position="$4"
  local label="$5"

  local full_dest="$TARGET/$dest_dir/$dest_name"
  mkdir -p "$TARGET/$dest_dir"

  # Extract title from first H1 line
  local title
  title=$(head -1 "$SOURCE/$src" | sed 's/^#\+ //')

  # Write front-matter + original content
  {
    echo "---"
    echo "title: \"$(echo "$title" | sed 's/"/\\"/g')\""
    echo "sidebar_label: \"$label\""
    echo "sidebar_position: $position"
    echo "---"
    echo ""
    cat "$SOURCE/$src"
  } > "$full_dest"

  echo "  $src -> $dest_dir/$dest_name"
}

# Helper: create _category_.json
category() {
  local dir="$1"
  local label="$2"
  local position="$3"
  local desc="$4"

  mkdir -p "$TARGET/$dir"

  if [ -n "$desc" ]; then
    cat > "$TARGET/$dir/_category_.json" << CATEOF
{
  "label": "$label",
  "position": $position,
  "link": {
    "type": "generated-index",
    "description": "$desc"
  }
}
CATEOF
  else
    cat > "$TARGET/$dir/_category_.json" << CATEOF
{
  "label": "$label",
  "position": $position
}
CATEOF
  fi
  echo "  [category] $dir -> $label (pos $position)"
}

echo "=== Creating category structure ==="

# Top-level categories
category "guides" "Guides" 1 "Step-by-step guides for setting up and using JYT Commerce features."
category "implementation" "Implementation" 2 "Technical implementation details, architecture decisions, and module documentation."
category "reference" "Reference" 3 "API references, platform details, status reports, and troubleshooting."

# Guides subcategories
category "guides/ad-planning" "Ad Planning" 1
category "guides/analytics" "Analytics" 2
category "guides/deployment" "Deployment" 3
category "guides/social-platforms" "Social Platforms" 4
category "guides/ai" "AI & Search" 5
category "guides/testing" "Testing" 6
category "guides/migration" "Migration" 7

# Implementation subcategories
category "implementation/ad-planning" "Ad Planning" 1
category "implementation/analytics" "Analytics" 2
category "implementation/social-publishing" "Social Publishing" 3
category "implementation/media" "Media" 4
category "implementation/security" "Security" 5
category "implementation/ai" "AI & Search" 6
category "implementation/integrations" "Integrations" 7
category "implementation/workflows" "Workflows" 8

# Reference subcategories
category "reference/social-api" "Social API" 1
category "reference/facebook" "Facebook" 2
category "reference/instagram" "Instagram" 3
category "reference/webhooks" "Webhooks" 4
category "reference/x-twitter" "X / Twitter" 5
category "reference/ui-components" "UI Components" 6
category "reference/status" "Status & Phases" 7

echo ""
echo "=== Migrating guide docs ==="

# --- GUIDES ---
migrate "AD_PLANNING_USAGE_GUIDE.md"     "guides/ad-planning"      "usage-guide.md"              1  "Usage Guide"
migrate "ANALYTICS_SETUP_SUMMARY.md"     "guides/analytics"        "setup-summary.md"            1  "Setup Summary"
migrate "ANALYTICS_WEBSITE_SETUP.md"     "guides/analytics"        "website-setup.md"            2  "Website Setup"
migrate "RAILWAY-DEPLOYMENT.md"          "guides/deployment"       "railway.md"                  1  "Railway"
migrate "RENDER-DEPLOYMENT.md"           "guides/deployment"       "render.md"                   2  "Render"
migrate "DEPLOYMENT_CHECKLIST.md"        "guides/deployment"       "checklist.md"                3  "Checklist"
migrate "RESEND_SETUP.md"               "guides/deployment"       "resend-email.md"             4  "Resend Email"
migrate "FACEBOOK_LOGIN_CORRECT_SETUP.md" "guides/social-platforms" "facebook-login.md"          1  "Facebook Login"
migrate "FACEBOOK_APP_SETUP_INSTAGRAM.md" "guides/social-platforms" "facebook-app-setup.md"      2  "Facebook App Setup"
migrate "FBINSTA_OAUTH_SETUP.md"         "guides/social-platforms" "meta-oauth.md"               3  "Meta OAuth"
migrate "FBINSTA_FLEXIBLE_PUBLISHING.md" "guides/social-platforms" "publishing-guide.md"         4  "Publishing Guide"
migrate "WEBHOOK_SETUP_GUIDE.md"         "guides/social-platforms" "webhook-setup.md"            5  "Webhook Setup"
migrate "OAUTH_FLOW_TEST_GUIDE.md"       "guides/social-platforms" "oauth-testing.md"            6  "OAuth Testing"
migrate "X_TWITTER_TESTING_GUIDE.md"     "guides/social-platforms" "x-twitter-testing.md"        7  "X/Twitter Testing"
migrate "INCREMENTAL_INDEXING_GUIDE.md"  "guides/ai"              "incremental-indexing.md"      1  "Incremental Indexing"
migrate "UI_TESTING_CHECKLIST.md"        "guides/testing"          "ui-testing-checklist.md"     1  "UI Testing Checklist"
migrate "PHASE_3_TESTING_GUIDE.md"       "guides/testing"          "phase-3-testing.md"          2  "Phase 3 Testing"
migrate "MIGRATION_GUIDE.md"            "guides/migration"        "migration-guide.md"           1  "Migration Guide"
migrate "design-editor-roadmap.md"       "guides/migration"        "design-editor-roadmap.md"    2  "Design Editor Roadmap"

echo ""
echo "=== Migrating implementation docs ==="

# --- IMPLEMENTATION ---
migrate "AD_PLANNING_MODULE.md"                    "implementation/ad-planning"        "module.md"                      1  "Module Plan"
migrate "META_ADS_INTEGRATION_PLAN.md"             "implementation/ad-planning"        "meta-ads-integration.md"        2  "Meta Ads Integration"
migrate "META_ADS_OVERVIEW_DRILLDOWN.md"           "implementation/ad-planning"        "meta-ads-drilldown.md"          3  "Meta Ads Drilldown"

migrate "ANALYTICS_ARCHITECTURE_DECISION.md"       "implementation/analytics"          "architecture-decision.md"       1  "Architecture Decision"
migrate "ANALYTICS_IMPLEMENTATION.md"              "implementation/analytics"          "implementation.md"              2  "Implementation"
migrate "ANALYTICS_COMPLETE_GUIDE.md"              "implementation/analytics"          "complete-guide.md"              3  "Complete Guide"
migrate "ANALYTICS_BACKGROUND_JOBS.md"             "implementation/analytics"          "background-jobs.md"             4  "Background Jobs"
migrate "ANALYTICS_MODULE_LINKING.md"              "implementation/analytics"          "module-linking.md"              5  "Module Linking"
migrate "ANALYTICS_MODULE_LINKING_READONLY.md"     "implementation/analytics"          "module-linking-readonly.md"     6  "Module Linking (Readonly)"
migrate "ANALYTICS_REALTIME.md"                    "implementation/analytics"          "realtime.md"                    7  "Realtime"
migrate "ANALYTICS_REALTIME_FIXES.md"              "implementation/analytics"          "realtime-fixes.md"              8  "Realtime Fixes"
migrate "ANALYTICS_REPORTING_APIS.md"              "implementation/analytics"          "reporting-apis.md"              9  "Reporting APIs"
migrate "ANALYTICS_SCRIPT_DEPLOYMENT.md"           "implementation/analytics"          "script-deployment.md"           10 "Script Deployment"

migrate "SOCIAL_PUBLISHING_IMPLEMENTATION.md"      "implementation/social-publishing"  "implementation.md"              1  "Implementation"
migrate "SOCIAL_WEBHOOKS_IMPLEMENTATION.md"        "implementation/social-publishing"  "webhooks.md"                    2  "Webhooks"
migrate "SMART_RETRY_PUBLISHING.md"                "implementation/social-publishing"  "smart-retry.md"                 3  "Smart Retry"
migrate "PUBLISHING_CAMPAIGNS_FEATURE.md"          "implementation/social-publishing"  "campaigns-feature.md"           4  "Campaigns Feature"
migrate "MULTI_IMAGE_CAROUSEL_SUPPORT.md"          "implementation/social-publishing"  "carousel-support.md"            5  "Carousel Support"
migrate "POST_INSIGHTS_SYNC.md"                    "implementation/social-publishing"  "post-insights-sync.md"          6  "Post Insights Sync"
migrate "HASHTAGS_MENTIONS_FEATURE.md"             "implementation/social-publishing"  "hashtags-mentions.md"           7  "Hashtags & Mentions"
migrate "HASHTAGS_MENTIONS_UI_IMPLEMENTATION.md"   "implementation/social-publishing"  "hashtags-ui.md"                 8  "Hashtags UI"
migrate "MULTI_PLATFORM_HASHTAG_SEARCH.md"         "implementation/social-publishing"  "hashtag-search.md"              9  "Hashtag Search"

migrate "PRODUCT_MEDIA_IMPLEMENTATION.md"          "implementation/media"              "product-media.md"               1  "Product Media"
migrate "CLOUDFLARE_IMAGE_TRANSFORMATION.md"       "implementation/media"              "cloudflare-images.md"           2  "Cloudflare Images"
migrate "MEDIA_THUMBNAIL_OPTIMIZATION.md"          "implementation/media"              "thumbnails.md"                  3  "Thumbnails"
migrate "PUBLIC_MEDIA_API.md"                      "implementation/media"              "public-api.md"                  4  "Public API"

migrate "TOKEN_ENCRYPTION_SERVICE.md"              "implementation/security"           "encryption-service.md"          1  "Encryption Service"
migrate "TOKEN_ENCRYPTION_AUDIT.md"                "implementation/security"           "encryption-audit.md"            2  "Encryption Audit"
migrate "TOKEN_ENCRYPTION_SUBSCRIBER.md"           "implementation/security"           "encryption-subscriber.md"       3  "Encryption Subscriber"

migrate "AI_IMAGE_GENERATION_TESTING.md"           "implementation/ai"                "image-generation.md"            1  "Image Generation"
migrate "AI_V2_COMPLEX_PROMPTS_FEATURE_PLAN.md"    "implementation/ai"                "complex-prompts.md"             2  "Complex Prompts"
migrate "CONTEXTUAL_RETRIEVAL_IMPLEMENTATION_SUMMARY.md" "implementation/ai"           "contextual-retrieval.md"        3  "Contextual Retrieval"
migrate "CONTEXTUAL_RETRIEVAL_IMPROVEMENTS.md"     "implementation/ai"                "retrieval-improvements.md"      4  "Retrieval Improvements"
migrate "CONTEXTUAL_RETRIEVAL_STATUS.md"           "implementation/ai"                "retrieval-status.md"            5  "Retrieval Status"
migrate "BM25_VS_INDEXED_COMPARISON.md"            "implementation/ai"                "bm25-comparison.md"             6  "BM25 Comparison"
migrate "SPEC_GENERATOR_ENHANCEMENTS.md"           "implementation/ai"                "spec-generator.md"              7  "Spec Generator"
migrate "design-editor-ai-integration.md"          "implementation/ai"                "design-editor-ai.md"            8  "Design Editor AI"

migrate "ETSY_SYNC_IMPLEMENTATION.md"              "implementation/integrations"       "etsy-sync.md"                   1  "Etsy Sync"
migrate "ETSY_SYNC_COMPLETE.md"                    "implementation/integrations"       "etsy-sync-complete.md"          2  "Etsy Sync Complete"
migrate "EXTERNAL_API_MANAGEMENT_SYSTEM.md"        "implementation/integrations"       "external-api.md"                3  "External API"
migrate "EXTERNAL_STORES_MODULE.md"                "implementation/integrations"       "external-stores.md"             4  "External Stores"
migrate "DESIGN_TO_CART_FLOW.md"                   "implementation/integrations"       "design-to-cart.md"              5  "Design to Cart"

migrate "VISUAL_WORKFLOW_BUILDER_ARCHITECTURE.md"  "implementation/workflows"          "builder-architecture.md"        1  "Builder Architecture"
migrate "INTEGRATED_SCRIPTS_WORKFLOW.md"           "implementation/workflows"          "integrated-scripts.md"          2  "Integrated Scripts"
migrate "TASK_STEPS_TO_CHILD_TASKS.md"             "implementation/workflows"          "task-steps.md"                  3  "Task Steps"
migrate "WORKFLOW_STEPS_CREATED.md"                "implementation/workflows"          "steps-created.md"               4  "Steps Created"
migrate "SCRIPTS_ANALYSIS_AND_IMPROVEMENTS.md"     "implementation/workflows"          "scripts-analysis.md"            5  "Scripts Analysis"
migrate "SCRIPTS_IMPROVEMENTS_SUMMARY.md"          "implementation/workflows"          "scripts-improvements.md"        6  "Scripts Improvements"
migrate "LOGGER_MIGRATION_SUMMARY.md"              "implementation/workflows"          "logger-migration.md"            7  "Logger Migration"

echo ""
echo "=== Migrating reference docs ==="

# --- REFERENCE ---
migrate "SOCIALS_API_ANALYSIS.md"                  "reference/social-api"              "api-analysis.md"                1  "API Analysis"
migrate "SOCIALS_API_REFACTORING_COMPLETE.md"      "reference/social-api"              "refactoring-complete.md"        2  "Refactoring Complete"
migrate "SOCIAL_PLATFORM_API_CONFIG_SCHEMA.md"     "reference/social-api"              "config-schema.md"               3  "Config Schema"
migrate "SOCIAL_POSTS_API_ANALYSIS.md"             "reference/social-api"              "posts-api-analysis.md"          4  "Posts API Analysis"
migrate "SOCIAL_POSTS_REFACTORING_PLAN.md"         "reference/social-api"              "posts-refactoring-plan.md"      5  "Posts Refactoring Plan"
migrate "SOCIAL_POSTS_REFACTORING_SUMMARY.md"      "reference/social-api"              "posts-refactoring-summary.md"   6  "Posts Refactoring Summary"
migrate "SOCIAL_POSTS_UI_IMPROVEMENTS.md"          "reference/social-api"              "posts-ui-improvements.md"       7  "Posts UI Improvements"
migrate "REFACTORING_OVERVIEW.md"                  "reference/social-api"              "refactoring-overview.md"        8  "Refactoring Overview"

migrate "FACEBOOK_API_V24_UPGRADE.md"              "reference/facebook"                "api-v24-upgrade.md"             1  "API v24 Upgrade"
migrate "FACEBOOK_APP_USE_CASES_SETUP.md"          "reference/facebook"                "app-use-cases.md"               2  "App Use Cases"
migrate "FACEBOOK_CONFIG_ID_SETUP.md"              "reference/facebook"                "config-id-setup.md"             3  "Config ID Setup"
migrate "FACEBOOK_LOGIN_FOR_BUSINESS_SETUP.md"     "reference/facebook"                "login-for-business.md"          4  "Login for Business"
migrate "FACEBOOK_PAGES_CACHE_OPTIMIZATION.md"     "reference/facebook"                "pages-cache.md"                 5  "Pages Cache"
migrate "FACEBOOK_POST_INSIGHTS_STRATEGY.md"       "reference/facebook"                "post-insights.md"               6  "Post Insights"
migrate "FBINSTA_CAPABILITIES_AND_FORMATS.md"      "reference/facebook"                "capabilities-formats.md"        7  "Capabilities & Formats"
migrate "FBINSTA_INTEGRATION_GUIDE.md"             "reference/facebook"                "integration-guide.md"           8  "Integration Guide"
migrate "FBINSTA_PUBLISH_POST_FIX.md"              "reference/facebook"                "publish-post-fix.md"            9  "Publish Post Fix"

migrate "INSTAGRAM_API_FIX.md"                     "reference/instagram"               "api-fix.md"                     1  "API Fix"
migrate "INSTAGRAM_LINKING_TROUBLESHOOTING.md"     "reference/instagram"               "linking-troubleshooting.md"     2  "Linking Troubleshooting"
migrate "INSTAGRAM_VIA_FACEBOOK_REFACTOR.md"       "reference/instagram"               "via-facebook-refactor.md"       3  "Via Facebook Refactor"

migrate "WEBHOOK_DIAGNOSTIC_GUIDE.md"              "reference/webhooks"                "diagnostic-guide.md"            1  "Diagnostic Guide"
migrate "WEBHOOK_SIGNATURE_FIX.md"                 "reference/webhooks"                "signature-fix.md"               2  "Signature Fix"
migrate "WEBHOOK_VERIFICATION_CHECKLIST.md"        "reference/webhooks"                "verification-checklist.md"      3  "Verification Checklist"

migrate "X_TWITTER_IMPLEMENTATION_STATUS.md"       "reference/x-twitter"               "implementation-status.md"       1  "Implementation Status"
migrate "X_TWITTER_INTEGRATION_ANALYSIS.md"        "reference/x-twitter"               "integration-analysis.md"        2  "Integration Analysis"
migrate "X_PROVIDER_ALIAS_SETUP.md"                "reference/x-twitter"               "provider-alias.md"              3  "Provider Alias"
migrate "SYNC_PLATFORM_HASHTAGS_MENTIONS.md"       "reference/x-twitter"               "sync-hashtags.md"               4  "Sync Hashtags"
migrate "HASHTAGS_MENTIONS_QUICK_START.md"         "reference/x-twitter"               "hashtags-quick-start.md"        5  "Hashtags Quick Start"

migrate "FILE_MODAL_ENHANCEMENT.md"                "reference/ui-components"           "file-modal-enhancement.md"      1  "File Modal Enhancement"
migrate "FILE_MODAL_FOLDER_FILTER_FIX.md"          "reference/ui-components"           "file-modal-filter.md"           2  "File Modal Filter"
migrate "FILE_MODAL_MEMORY_OPTIMIZATION.md"        "reference/ui-components"           "file-modal-memory.md"           3  "File Modal Memory"
migrate "FILE_MODAL_UI_IMPROVEMENTS.md"            "reference/ui-components"           "file-modal-ui.md"               4  "File Modal UI"
migrate "DESIGN_PARTNER_FILTER_VIEWS.md"           "reference/ui-components"           "partner-filter-views.md"        5  "Partner Filter Views"

migrate "PRODUCTION_RUNS_STATUS_AND_NEXT_STEPS.md" "reference/status"                  "production-status.md"           1  "Production Status"
migrate "UNIFIED_WORKFLOW_DOCUMENTATION.md"        "reference/status"                  "unified-workflow.md"            2  "Unified Workflow"
migrate "UNIFIED_WORKFLOW_TEST_SUMMARY.md"         "reference/status"                  "workflow-test-summary.md"       3  "Workflow Test Summary"
migrate "IMPLEMENTATION_COMPLETE.md"               "reference/status"                  "implementation-complete.md"     4  "Implementation Complete"
migrate "PHASE_0_COMPLETE.md"                      "reference/status"                  "phase-0.md"                     5  "Phase 0"
migrate "PHASE_0_1_COMPLETE.md"                    "reference/status"                  "phase-0-1.md"                   6  "Phase 0.1"
migrate "PHASE_2_REFACTORING_PLAN.md"              "reference/status"                  "phase-2.md"                     7  "Phase 2"
migrate "PHASE_4_5_6_SUMMARY.md"                   "reference/status"                  "phase-4-5-6.md"                 8  "Phase 4-5-6"

echo ""
echo "=== Migration complete! ==="
echo "Migrated files to $TARGET"
