# Documentation

This folder contains all documentation related to the social media integration features.

## 📚 Documentation Files

### Facebook & Instagram Integration
- **FBINSTA_FLEXIBLE_PUBLISHING.md** - Choose Facebook, Instagram, or Both platforms
- **INSTAGRAM_VIA_FACEBOOK_REFACTOR.md** - Using Facebook Login for Instagram
- **FBINSTA_INTEGRATION_GUIDE.md** - Complete FBINSTA platform guide
- **FBINSTA_CAPABILITIES_AND_FORMATS.md** - Platform capabilities and format differences
- **FBINSTA_OAUTH_SETUP.md** - OAuth setup guide

### Facebook Setup Guides
- **FACEBOOK_APP_USE_CASES_SETUP.md** - Facebook App use cases configuration
- **FACEBOOK_APP_SETUP_INSTAGRAM.md** - Facebook App setup for Instagram
- **FACEBOOK_LOGIN_CORRECT_SETUP.md** - Correct Facebook Login setup
- **FACEBOOK_LOGIN_FOR_BUSINESS_SETUP.md** - Facebook Login for Business guide
- **FACEBOOK_CONFIG_ID_SETUP.md** - Configuration ID setup
- **FACEBOOK_API_V24_UPGRADE.md** - Facebook Graph API v24.0 upgrade

### Instagram Guides
- **INSTAGRAM_API_FIX.md** - Instagram API troubleshooting
- **INSTAGRAM_LINKING_TROUBLESHOOTING.md** - Instagram account linking issues

### General
- **SOCIAL_PUBLISHING_IMPLEMENTATION.md** - Social publishing implementation overview

### Other Features
- **MEDIA_THUMBNAIL_OPTIMIZATION.md** - Media thumbnail optimization
- **PRODUCT_MEDIA_IMPLEMENTATION.md** - Product media implementation
- **TASK_STEPS_TO_CHILD_TASKS.md** - Task steps to child tasks conversion

### Deployment
- **RAILWAY-DEPLOYMENT.md** - Railway deployment guide
- **RESEND_SETUP.md** - Resend email service setup

## 🔒 Security Note

All documentation files have been sanitized to remove real credentials. When setting up your own app:

1. Replace `YOUR_FACEBOOK_APP_ID` with your actual Facebook App ID
2. Replace `YOUR_FACEBOOK_APP_SECRET` with your actual Facebook App Secret
3. Replace `YOUR_CONFIG_ID` with your actual Configuration ID (if using Facebook Login for Business)

**Never commit real credentials to version control!**

## 📖 Quick Start

1. Start with **FBINSTA_FLEXIBLE_PUBLISHING.md** for the latest features
2. Follow **FACEBOOK_APP_USE_CASES_SETUP.md** for Facebook App configuration
3. Use **FBINSTA_OAUTH_SETUP.md** for OAuth setup
4. Refer to **FBINSTA_CAPABILITIES_AND_FORMATS.md** for platform capabilities

## 🔗 Related Files

- `.env.template` - Environment variable template
- `src/modules/social-provider/` - Social provider services
- `src/workflows/socials/` - Publishing workflows
- `src/api/admin/socials/` - API endpoints
