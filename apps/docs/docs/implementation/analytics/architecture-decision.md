---
title: "Analytics Architecture Decision"
sidebar_label: "Architecture Decision"
sidebar_position: 1
---

# Analytics Architecture Decision

## Current Implementation ✅

You've correctly renamed the module to `custom_analytics` to avoid conflicts with MedusaJS's built-in Analytics Module.

**Module Name:** `custom_analytics`  
**Location:** `src/modules/analytics/`  
**Purpose:** Self-hosted, database-backed analytics for website tracking

## MedusaJS Built-in Analytics Module

MedusaJS v2.8.3+ includes an **Analytics Module** (`@medusajs/medusa/analytics`) that:
- Uses **providers** to send data to third-party services (PostHog, Segment, etc.)
- Doesn't store data locally - just forwards events
- Resolves via `Modules.ANALYTICS`
- Configured in `medusa-config.ts` with providers

**Example:**
```typescript
// Built-in Analytics Module usage
const analyticsService = container.resolve(Modules.ANALYTICS);
await analyticsService.track({
  event: "order_placed",
  actor_id: customer_id,
  properties: { order_id, total }
});
```

## Two Approaches Comparison

### Approach 1: Custom Module (Current - RECOMMENDED ✅)

**What you have now:**
- Custom module: `custom_analytics`
- Stores data in your own database (AnalyticsEvent, AnalyticsSession, AnalyticsDailyStats)
- Full control over data structure and retention
- Privacy-focused (no third-party services)
- Can query and report on your own data

**Pros:**
- ✅ Full data ownership
- ✅ No external dependencies
- ✅ Custom reporting and aggregation
- ✅ Privacy-compliant (GDPR)
- ✅ No recurring costs
- ✅ Can integrate with your website module directly
- ✅ Fast queries on your own data

**Cons:**
- ❌ Need to maintain your own analytics logic
- ❌ Need to build your own dashboards
- ❌ Storage costs (minimal)

**Use Cases:**
- Website analytics (pageviews, sessions, referrers)
- Customer behavior tracking
- Content performance metrics
- Internal reporting

### Approach 2: Analytics Provider (Alternative)

**What it would be:**
- Create a custom provider for MedusaJS Analytics Module
- Implements `IAnalyticsModuleProvider` interface
- Could send data to your database OR third-party service
- Integrates with Medusa's event system

**Pros:**
- ✅ Integrates with Medusa's workflows
- ✅ Standard interface
- ✅ Can track commerce events (orders, carts, etc.)
- ✅ Works with Medusa's event bus

**Cons:**
- ❌ More complex to implement
- ❌ Limited to Medusa's analytics interface
- ❌ Harder to customize data structure
- ❌ Not ideal for website-specific tracking

**Use Cases:**
- E-commerce event tracking (orders, carts, checkouts)
- Customer lifecycle events
- Integration with analytics platforms (Segment, Mixpanel)

## Recommendation: Hybrid Approach 🎯

**Keep both!** They serve different purposes:

### 1. Custom Analytics Module (Website Tracking)
**Current implementation - Keep as is**

```typescript
// For website analytics
import { ANALYTICS_MODULE } from "../../modules/analytics";

const service = container.resolve(ANALYTICS_MODULE);
await service.createAnalyticsEvents({
  website_id,
  event_type: "pageview",
  pathname,
  visitor_id,
  session_id,
  // ... website-specific data
});
```

**Use for:**
- Website pageviews and sessions
- Content analytics
- Referrer tracking
- Device/browser stats
- Geographic data
- Custom website events

### 2. MedusaJS Analytics Module (Commerce Tracking)
**Add this for commerce events**

```typescript
// For commerce analytics
import { Modules } from "@medusajs/framework/utils";

const analyticsService = container.resolve(Modules.ANALYTICS);
await analyticsService.track({
  event: "product_viewed",
  actor_id: customer_id,
  properties: { product_id, variant_id }
});
```

**Use for:**
- Order placed
- Cart updated
- Product viewed
- Checkout started
- Payment completed
- Customer registered

## Implementation Checklist

### ✅ Already Done:
- [x] Custom analytics module created
- [x] Renamed to `custom_analytics` (no conflicts)
- [x] Models defined (Event, Session, DailyStats)
- [x] Workflows created
- [x] Public tracking API
- [x] Admin CRUD APIs

### 🔄 Optional Enhancements:

#### A. Add MedusaJS Analytics Module (for commerce events)

**1. Install and configure:**
```typescript
// medusa-config.ts
modules: [
  {
    resolve: "@medusajs/medusa/analytics",
    options: {
      providers: [
        {
          resolve: "@medusajs/medusa/analytics-local", // or custom provider
          id: "local",
        },
      ],
    },
  },
  {
    resolve: "./src/modules/analytics", // Your custom module
  },
]
```

**2. Create workflows for commerce events:**
```typescript
// src/workflows/analytics/track-order-placed.ts
import { Modules } from "@medusajs/framework/utils";

const trackOrderStep = createStep(
  "track-order-placed",
  async ({ order }, { container }) => {
    const analyticsService = container.resolve(Modules.ANALYTICS);
    await analyticsService.track({
      event: "order_placed",
      actor_id: order.customer_id,
      properties: {
        order_id: order.id,
        total: order.total,
      },
    });
  }
);
```

#### B. Create Custom Analytics Provider (Advanced)

If you want to send commerce events to your database:

**1. Create provider:**
```typescript
// src/modules/analytics-provider/service.ts
import { AbstractAnalyticsModuleProvider } from "@medusajs/framework/utils";

class CustomAnalyticsProvider extends AbstractAnalyticsModuleProvider {
  async track(data) {
    // Send to your custom_analytics module
    const customAnalytics = this.container_.resolve("custom_analytics");
    await customAnalytics.createAnalyticsEvents({
      // Transform commerce event to your format
      event_type: "custom_event",
      event_name: data.event,
      metadata: data.properties,
      // ...
    });
  }
  
  async identify(data) {
    // Implement user identification
  }
}
```

**2. Register provider:**
```typescript
// medusa-config.ts
modules: [
  {
    resolve: "@medusajs/medusa/analytics",
    options: {
      providers: [
        {
          resolve: "./src/modules/analytics-provider",
          id: "custom",
        },
      ],
    },
  },
]
```

## Current Status Summary

✅ **Your current implementation is solid!**

**What you have:**
- Custom analytics module: `custom_analytics`
- No conflicts with MedusaJS built-in analytics
- Full database-backed website analytics
- Privacy-focused, self-hosted solution

**What's working:**
- Website pageview tracking
- Session management
- Event storage
- Public tracking API
- Admin CRUD operations

**No changes needed** - your naming (`custom_analytics`) already avoids conflicts!

## Next Steps (Optional)

1. **Keep current implementation** for website analytics ✅
2. **Optionally add** MedusaJS Analytics Module for commerce events
3. **Consider creating** a custom provider if you want commerce events in your database
4. **Build dashboards** to visualize your custom analytics data

## References

- [MedusaJS Analytics Module](https://docs.medusajs.com/resources/infrastructure-modules/analytics)
- [Create Analytics Provider](https://docs.medusajs.com/resources/references/analytics/provider)
- [PostHog Provider Example](https://docs.medusajs.com/resources/infrastructure-modules/analytics/posthog)
- [Segment Integration Guide](https://docs.medusajs.com/resources/integrations/guides/segment)

---

**Conclusion:** Your current approach is perfect for website analytics. The `custom_analytics` name avoids conflicts. You can optionally add MedusaJS's Analytics Module later for commerce-specific event tracking if needed.
