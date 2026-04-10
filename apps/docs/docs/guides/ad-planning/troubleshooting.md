---
title: "Ad Planning - Troubleshooting"
sidebar_label: "Troubleshooting"
sidebar_position: 2
---

# Ad Planning — Troubleshooting

Common issues and how to resolve them.

_Last updated: 2026-04-10_

---

## Revenue Shows €0 / "—"

**Symptom**: Dashboard or Metrics page shows €0 for Total Revenue even though orders exist.

**Cause**: The `conversion_value` field on purchase conversions is NULL. This happens when:
- The `trackPurchaseConversionWorkflow` used `orderService.retrieveOrder()` which doesn't compute totals (fixed April 2026)
- The order was placed before the ad-planning subscriber was deployed

**Fix**:
1. Check if the conversion exists: `GET /admin/ad-planning/conversions?conversion_type=purchase`
2. If `conversion_value` is null, backfill it from the order summary:

```sql
-- Find affected conversions
SELECT c.id, c.order_id, c.conversion_value
FROM conversion c
WHERE c.conversion_type = 'purchase'
  AND c.conversion_value IS NULL;

-- Backfill from order_summary
UPDATE conversion c
SET conversion_value = (
  SELECT (os.totals->>'paid_total')::numeric
  FROM order_summary os
  WHERE os.order_id = c.order_id
  LIMIT 1
)
WHERE c.conversion_type = 'purchase'
  AND c.conversion_value IS NULL;
```

---

## Segments Always Show 0 Members

**Symptom**: A segment with rules like `total_orders >= 5` or `avg_order_value >= 100` always evaluates to 0 members.

**Possible causes**:

1. **No data**: Check if customers actually have enough orders/conversions:
   ```bash
   GET /admin/ad-planning/conversions?conversion_type=purchase
   ```

2. **Threshold too high**: The segment criteria threshold exceeds what any customer has. Check actual values:
   ```sql
   SELECT customer_id, COUNT(*) as orders
   FROM "order" WHERE deleted_at IS NULL
   GROUP BY customer_id ORDER BY orders DESC LIMIT 10;
   ```

3. **Field name mismatch** (fixed April 2026): Prior to the April fix, fields like `total_orders`, `total_spent`, `avg_order_value`, `days_since_last_order`, and `clv` didn't exist in the enriched data. If you created segments before the fix, rebuild them.

**Fix**: Trigger a segment rebuild:
```bash
PUT /admin/ad-planning/segments/{id}
{ "rebuild": true }
```

---

## Percentile Shows "—" for All Scores

**Symptom**: The Percentile column in Customer Scores always shows a dash.

**Cause**: Percentile is only meaningful with 2+ customers scored for the same type. With a single customer, it returns null (displayed as "—").

**Fix**: Score more customers. Scores are calculated automatically after purchase events, or manually:
```bash
POST /admin/ad-planning/scores
{ "person_id": "person_abc", "score_type": "engagement" }
```

---

## Attribution Shows 0 Records

**Symptom**: The Attribution page is empty even though there are analytics sessions.

**Possible causes**:

1. **No UTM parameters on sessions**: Attribution only creates records for sessions with `utm_campaign` data. Verify your storefront analytics sends UTM parameters.

2. **Analytics session missing UTM columns** (fixed April 2026): The `analytics_session` table didn't have UTM columns, so the attribution workflow couldn't read them. After migration, new sessions will populate correctly.

3. **Bulk resolve hasn't run**: The daily job runs at 2 AM. Trigger manually:
   ```bash
   POST /admin/ad-planning/attribution/resolve
   { "bulk": true, "days_back": 30, "limit": 5000 }
   ```

---

## A/B Experiment Shows "Not Significant" When Treatment Wins

**Symptom**: An A/B experiment where the treatment clearly outperforms control is marked "Not statistically significant" or "Inconclusive".

**Cause** (fixed April 2026): The p-value formula returned values > 1 for negative z-scores (treatment > control), causing `getSignificanceLevel` to fall through all thresholds.

**Fix**: After deploying the April fix, stop and restart the experiment, or trigger a results recalculation:
```bash
GET /admin/ad-planning/experiments/{id}/results
```

---

## Currency Shows ₹ Instead of €

**Symptom**: Revenue, CLV, and spend values display with ₹ (Indian Rupee) instead of the store's actual currency.

**Cause** (fixed April 2026):
- The `conversion.currency` model defaulted to "INR"
- The UI had hardcoded ₹ symbols

**Fix**: After deploying the April fix:
- New conversions will use the order's actual currency
- The UI uses `useCurrencyFormatter` which reads the store's default currency
- Meta Ads spend (in INR) is automatically converted to the store currency via exchange rate

---

## Dashboard ROI Shows 0%

**Symptom**: Campaign ROI is 0 even though both spend and revenue exist.

**Possible causes**:

1. **No ad_account_id filter**: The dashboard requires `?ad_account_id=` to load campaign data. Without it, no campaigns are fetched and ROI is empty.

2. **Currency mismatch**: Spend (in ad account currency, e.g. INR) and revenue (in store currency, e.g. EUR) are compared directly. The dashboard route doesn't perform currency conversion — this is displayed at the UI level.

---

## Weekly Score Job Takes Too Long

**Symptom**: The `recalculate-customer-scores` job times out or runs for hours.

**Cause** (fixed April 2026): Previously the job loaded ALL conversions and journeys into memory and processed every person sequentially with 3 serial workflow calls per person.

**Fix**: The April update:
- Filters to only customers with activity in the last 30 days
- Paginates data loading (500 rows/page)
- Runs 5 customers concurrently
- Runs all 3 score workflows in parallel per customer

If the job still takes too long, reduce the `ACTIVITY_WINDOW_DAYS` constant in `recalculate-scores-job.ts`.
