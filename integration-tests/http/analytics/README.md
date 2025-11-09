# Analytics Integration Tests

## Overview
End-to-end integration tests for the custom analytics tracking system.

## Test Coverage

### 1. **Basic Tracking Flow**
- ✅ Track pageview events
- ✅ Create analytics events in database
- ✅ Create new sessions
- ✅ Update existing sessions
- ✅ Track custom events with metadata

### 2. **Data Parsing**
- ✅ User agent parsing (browser, OS, device type)
- ✅ Referrer source extraction (Google, Facebook, Twitter, etc.)
- ✅ Device type detection (desktop, mobile, tablet)

### 3. **Session Management**
- ✅ Create session on first pageview
- ✅ Update session on subsequent pageviews
- ✅ Track pageview count
- ✅ Bounce rate calculation (single page vs multiple pages)
- ✅ Entry and exit page tracking

### 4. **Performance & Reliability**
- ✅ Handle concurrent requests
- ✅ Async workflow processing
- ✅ Error handling (returns 200 even on errors for security)

### 5. **Admin APIs**
- ✅ List analytics events
- ✅ Filter by website_id
- ✅ Filter by event_type
- ✅ Pagination support

## Running Tests

### Run All Analytics Tests
```bash
npm run test:integration -- analytics
```

### Run Specific Test File
```bash
npm run test:integration -- track-analytics-event.spec.ts
```

### Run with Watch Mode
```bash
npm run test:integration:watch -- analytics
```

### Run with Coverage
```bash
npm run test:integration -- --coverage analytics
```

## Test Structure

```
integration-tests/http/analytics/
├── README.md (this file)
└── track-analytics-event.spec.ts
    ├── Analytics Tracking E2E Flow
    │   ├── POST /web/analytics/track
    │   │   ├── Basic pageview tracking
    │   │   ├── Event creation in database
    │   │   ├── Session creation
    │   │   ├── Session updates
    │   │   ├── Custom event tracking
    │   │   ├── User agent parsing
    │   │   ├── Referrer source extraction
    │   │   ├── Concurrent requests
    │   │   └── Error handling
    │   └── Admin Analytics APIs
    │       ├── List events
    │       └── Filter events
```

## Test Data

### Test Website
Each test creates a fresh website:
```typescript
{
  domain: "test-analytics.example.com",
  name: "Test Analytics Site",
  status: "Active",
  primary_language: "en"
}
```

### Sample Tracking Request
```typescript
{
  website_id: "website_123",
  event_type: "pageview",
  pathname: "/test-page",
  referrer: "https://google.com",
  visitor_id: "visitor_test_123",
  session_id: "session_test_456"
}
```

## Expected Results

### Event Creation
After tracking, the database should contain:
- **AnalyticsEvent** with parsed user agent data
- **AnalyticsSession** with session metrics
- Correct referrer source (e.g., "google", "facebook")
- Correct device type (desktop, mobile, tablet)

### Session Behavior
- **First pageview:** Creates new session with `is_bounce: true`
- **Second pageview:** Updates session with `is_bounce: false`, increments pageview count
- **Entry page:** Set on first pageview
- **Exit page:** Updated on each subsequent pageview

## Debugging Tests

### View Test Output
```bash
npm run test:integration -- analytics --verbose
```

### Check Database State
The tests use the integration test database. You can inspect it during test runs.

### Common Issues

#### 1. Timeout Errors
Tests include `await new Promise(resolve => setTimeout(resolve, 1000))` to allow async workflows to complete. If tests fail, try increasing these delays.

#### 2. Database Not Cleaned
Each test creates a new website, but if you see data from previous runs, check the test cleanup hooks.

#### 3. Module Not Resolved
Ensure `custom_analytics` module is registered in `medusa-config.ts`:
```typescript
{
  resolve: "./src/modules/analytics",
}
```

## Test Assertions

### Event Assertions
```typescript
expect(event.website_id).toBe(websiteId);
expect(event.event_type).toBe("pageview");
expect(event.pathname).toBe("/test-page");
expect(event.referrer_source).toBe("google");
expect(event.device_type).toBe("mobile");
expect(event.browser).toBe("Chrome");
expect(event.os).toBe("iOS");
```

### Session Assertions
```typescript
expect(session.entry_page).toBe("/home");
expect(session.exit_page).toBe("/about");
expect(session.pageviews).toBe(2);
expect(session.is_bounce).toBe(false);
```

## Next Steps

After tests pass:
1. ✅ Analytics tracking is working end-to-end
2. ⬜ Create client-side tracking script
3. ⬜ Build reporting APIs
4. ⬜ Add background jobs for aggregation
5. ⬜ Create admin UI dashboard

## CI/CD Integration

Add to your CI pipeline:
```yaml
- name: Run Analytics Tests
  run: npm run test:integration -- analytics
```

## Performance Benchmarks

Expected test execution times:
- Basic tracking: ~1-2 seconds per test
- User agent parsing: ~5-10 seconds (multiple test cases)
- Concurrent requests: ~3-5 seconds
- Full suite: ~30-60 seconds

## Related Documentation

- [Analytics Implementation Guide](../../../docs/ANALYTICS_IMPLEMENTATION.md)
- [Architecture Decision](../../../docs/ANALYTICS_ARCHITECTURE_DECISION.md)
- [MedusaJS Testing Framework](https://docs.medusajs.com/resources/test-tools-reference)
