# Publishing Campaigns Feature

## Overview

The Publishing Campaigns feature enables automated, scheduled social media publishing for multiple products. It allows admins to create campaigns that automatically publish content at specified intervals, with full control over content generation rules, lifecycle management, and error handling.

## Architecture

### Module Structure

```
src/
├── modules/socials/
│   ├── models/
│   │   └── PublishingCampaign.ts      # Campaign entity model
│   ├── services/
│   │   └── content-generator-service.ts # Content generation utility
│   └── types/
│       └── publishing-automation.ts    # TypeScript types
├── api/admin/publishing-campaigns/
│   ├── route.ts                        # List & Create campaigns
│   └── [id]/
│       ├── route.ts                    # Get, Update, Delete
│       ├── start/route.ts              # Start campaign
│       ├── pause/route.ts              # Pause campaign
│       ├── cancel/route.ts             # Cancel campaign
│       ├── preview/route.ts            # Generate preview
│       ├── retry-item/route.ts         # Retry single item
│       └── retry-all/route.ts          # Retry all failed items
├── workflows/socials/scheduled-publishing/
│   ├── preview-campaign-workflow.ts    # Preview content generation
│   └── process-campaign-item-workflow.ts # Publish single item
├── jobs/
│   └── campaign-publisher.ts           # Scheduled job (every 5 min)
└── admin/
    ├── routes/publishing-campaigns/
    │   ├── page.tsx                    # Campaign list page
    │   └── [id]/
    │       ├── page.tsx                # Campaign detail page
    │       ├── loader.ts               # Data prefetching
    │       └── @edit/page.tsx          # Edit drawer
    ├── hooks/api/
    │   └── publishing-campaigns.ts     # React Query hooks
    └── components/edits/
        └── edit-campaign.tsx           # Edit form component
```

## Campaign Lifecycle

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌───────────┐
│  DRAFT  │────▶│ PREVIEW │────▶│  ACTIVE │────▶│ COMPLETED │
└─────────┘     └─────────┘     └─────────┘     └───────────┘
     │               │               │
     │               │               ▼
     │               │          ┌─────────┐
     │               └─────────▶│  PAUSED │
     │                          └─────────┘
     │                               │
     ▼                               ▼
┌───────────┐                  ┌───────────┐
│ CANCELLED │◀─────────────────│ CANCELLED │
└───────────┘                  └───────────┘
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `draft` | Initial state, can be edited |
| `preview` | Content preview generated |
| `active` | Campaign is running, scheduler processes items |
| `paused` | Temporarily stopped, can be resumed |
| `completed` | All items published successfully |
| `cancelled` | Manually stopped, cannot be resumed |

## API Endpoints

### Campaign CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/publishing-campaigns` | List campaigns (with filters) |
| `POST` | `/admin/publishing-campaigns` | Create new campaign |
| `GET` | `/admin/publishing-campaigns/:id` | Get campaign details |
| `PUT` | `/admin/publishing-campaigns/:id` | Update campaign (draft/paused only) |
| `DELETE` | `/admin/publishing-campaigns/:id` | Delete campaign |

### Campaign Actions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/admin/publishing-campaigns/:id/start` | Start/resume campaign |
| `POST` | `/admin/publishing-campaigns/:id/pause` | Pause active campaign |
| `POST` | `/admin/publishing-campaigns/:id/cancel` | Cancel campaign |
| `POST` | `/admin/publishing-campaigns/:id/preview` | Generate content preview |
| `POST` | `/admin/publishing-campaigns/:id/retry-item` | Retry single failed item |
| `POST` | `/admin/publishing-campaigns/:id/retry-all` | Retry all failed items |

## Content Rules

Content generation is controlled by `content_rule` configuration:

```typescript
interface ContentRule {
  hashtag_strategy: "from_product" | "from_design" | "custom" | "none"
  image_selection: "thumbnail" | "first" | "all" | "featured"
  custom_hashtags?: string[]
  caption_template?: string
}
```

### Hashtag Strategies

- **from_product**: Extract hashtags from product tags/categories
- **from_design**: Use hashtags from linked design
- **custom**: Use manually specified hashtags
- **none**: No hashtags

### Image Selection

- **thumbnail**: Product thumbnail only
- **first**: First product image
- **all**: All images (carousel post)
- **featured**: Featured/thumbnail image

## Campaign Items

Each campaign contains items representing products to publish:

```typescript
interface CampaignItem {
  product_id: string
  status: "pending" | "publishing" | "published" | "failed" | "skipped"
  scheduled_at?: Date
  published_at?: Date
  social_post_id?: string
  error_message?: string
}
```

## Scheduler Job

The `campaign-publisher` job runs every 5 minutes and:

1. Finds active campaigns with pending items
2. Checks if `next_publish_at` has passed
3. Processes the next item using `processCampaignItemWorkflow`
4. Updates campaign status and schedules next item
5. Sends admin notifications on failures/completions

## Admin UI Features

### Campaign List Page
- DataTable with filtering by status
- Pagination with URL params
- Quick actions (view, delete)
- Create campaign button

### Campaign Detail Page
- Two-column layout with general info and stats
- Campaign items with product thumbnails
- Action buttons (Start, Pause, Cancel, Preview)
- Retry buttons for failed items
- Edit drawer for draft/paused campaigns

### Edit Campaign Drawer
- Route-based drawer (`@edit/page.tsx`)
- Edit name, interval, content rules
- Only available for draft/paused campaigns

## React Query Hooks

```typescript
// Queries
useCampaigns(params?)      // List campaigns
useCampaign(id, options?)  // Get single campaign

// Mutations
useCreateCampaign()
useUpdateCampaign()
useDeleteCampaign()
useStartCampaign()
usePauseCampaign()
useCancelCampaign()
usePreviewCampaign()
useRetryCampaignItem()
useRetryAllFailedItems()
```

## Admin Notifications

Notifications are sent to the admin feed for:
- Campaign item failures
- Campaign completion
- Campaign processing errors

## Testing

Integration tests are located at:
```
integration-tests/http/socials/publishing-campaigns-api.spec.ts
```

Run tests:
```bash
yarn test:integration integration-tests/http/socials/publishing-campaigns-api.spec.ts
```

## Potential Improvements

### High Priority
1. **Campaign Duplication** - Clone existing campaigns with new products
2. **Scheduled Start** - Set a future start time for campaigns
3. **Campaign Templates** - Save and reuse content rule configurations
4. **Bulk Operations** - Select multiple campaigns for batch actions

### Medium Priority
5. **Campaign Analytics** - Track engagement metrics across campaign items
6. **A/B Testing** - Test different content rules within a campaign
7. **Smart Scheduling** - AI-powered optimal posting times
8. **Cross-Platform Campaigns** - Single campaign publishing to multiple platforms

### Low Priority
9. **Campaign Collaboration** - Multiple admins managing campaigns
10. **Approval Workflow** - Review content before publishing
11. **Content Calendar View** - Visual calendar of scheduled posts
12. **Campaign Reports** - Export campaign performance data

## Database Schema

```sql
-- PublishingCampaign table
CREATE TABLE publishing_campaign (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'draft',
  platform_id VARCHAR REFERENCES social_platform(id),
  content_rule JSONB,
  items JSONB DEFAULT '[]',
  interval_hours INTEGER DEFAULT 24,
  current_index INTEGER DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  paused_at TIMESTAMP,
  next_publish_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);
```

## Configuration

The scheduler job interval can be configured in:
```typescript
// src/jobs/campaign-publisher.ts
export default {
  name: "campaign-publisher",
  schedule: "*/5 * * * *", // Every 5 minutes
}
```

## Error Handling

- Failed items are marked with `status: "failed"` and `error_message`
- Admin notifications sent on failures
- Retry functionality for individual or all failed items
- Campaign continues processing remaining items after failures

## Security

- All endpoints require admin authentication
- Campaign actions validate current status before proceeding
- Edit operations restricted to draft/paused campaigns
