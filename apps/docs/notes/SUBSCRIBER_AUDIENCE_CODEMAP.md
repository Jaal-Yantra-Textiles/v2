# Subscriber / Newsletter Audience — Codemap

> How blog & newsletter recipients are assembled today, where every "person" comes
> from, and what provenance exists — the grounding for the **audience grouping**
> epic **#881** (segment sends by source: imported-file / ad-lead / customer / manual /
> partner). Companion to #839 (real subscribe/unsubscribe semantics).

## TL;DR

- The blog/newsletter send pulls **one flat, deduped list** = **union of 3 sources**:
  person-subscribers **+ all customers + non-dead meta/email leads**. No grouping.
- **Meta/ad leads already exist** — `socials` module `Lead` model (from Meta lead-ads
  webhook + inbound email). They're already in the send audience.
- **No `source` field on person** — provenance is an inconsistent `metadata.source`
  string, stamped by only 3 of 6 creation paths.
- **A segment model already exists** (`CustomerSegment` / `SegmentMember` in
  ad-planning) but is **not wired to sends** — candidate to reuse for groups.

## The send path — the crux

`apps/backend/src/workflows/blogs/send-blog-subscribers/`
- `steps/get-subscribers.ts` → `getSubscribersStep` builds `Map<email, Subscriber>`
  by **merging three sources** (dedupe by email):
  1. **Person subscribers** — `personService.listPeople({}, { relations: ["subscribed"] })`,
     kept only if `person.subscribed?.subscription_status === "active"`.
  2. **All customers** — `customerService.listCustomers({})` (Medusa customer module) —
     **every customer, unconditionally**.
  3. **Meta/email leads** — `socialsService.listLeads({ status: { $nin: ["archived","lost","unqualified"] } })`.
- `workflows/send-blog-subscribers.ts` fans out the email.
- **Hook point for grouping:** the per-source inclusion checks in `get-subscribers.ts`
  (add a `group_ids` / `sources` filter param; select membership before `.set()`).
- **Newsletter** reuses the Blog send path (see `project_659_newsletter_page_type`).

## Person model

`apps/backend/src/modules/person/models/person.ts`
```
person: id, first_name, last_name, email(unique,nullable), date_of_birth,
        metadata(json), notes, avatar, public_metadata(json),
        state enum[Onboarding|Stalled|Conflicted|Onboarding Finished],
        addresses[], contact_details[], tags[] (hasMany Tag),
        subscribed hasOne -> PersonSub
```
- **No `source`/provenance column.** `metadata.source` is the ad-hoc convention.
- `tags` (hasMany) already exists — a possible grouping primitive, but free-form.

## Subscription model

`apps/backend/src/modules/person/models/person_subs.ts`
```
person_subs: id, subscription_type enum[email|sms],
             network enum[cicilabel|jaalyantra],
             subscription_status enum[active|inactive],
             email_subscribed text,   // #839 wants this normalized to bool+timestamps
             person belongsTo
```
- "Is a subscriber" = a `PersonSub` with `subscription_status === "active"`.
- **Only the person source respects subscription status** — customers & leads are
  included regardless (no opt-out honored for them today). #839 territory.

## Leads (meta/ad + email) — `socials` module

`apps/backend/src/modules/socials/models/Lead.ts`
```
Lead: ... source_platform(facebook|instagram|email|...),
      ad_id, campaign_id, form_id, form_name,   // full ad provenance
      person_id (nullable)  // optional link to a Person — usually NOT set
      status(...)           // archived/lost/unqualified excluded from sends
```
- Ingestion: Meta lead-ads webhook `api/webhooks/meta-ads/leadgen/route.ts` creates a
  `Lead` directly (**no Person created**). Email leads via `jobs/ingest-lead-emails.ts`
  (`metadata.source: "inbound_email"`).
- So **ad-leads are a first-class source already** — they just aren't `Person`s and
  aren't grouped.

## Segment model (exists, unused for sends) — ad-planning

- `modules/ad-planning/models/customer-segment.ts` — `CustomerSegment`
  { name, description, segment_type[behavioral|demographic|rfm|custom], criteria(json),
  customer_count, last_calculated_at, is_active, auto_update, color, metadata }.
- `modules/ad-planning/models/segment-member.ts` — `SegmentMember`
  { segment, person_id, added_at, added_reason[rule_match|manual|import], score_at_addition }.
- `links/segment-member-person-link.ts` links member ↔ person.
- **Reuse candidate** for named audience groups (or add a leaner `NewsletterGroup`).

## Where each person comes from + provenance stamping

| Creation path | File | `metadata.source` stamped? |
|---|---|---|
| Order placed (manual orders) | `workflows/ad-planning/conversions/track-purchase-conversion.ts` | ✓ `ad_planning_order_placed` |
| Backfill historical orders (#664) | `api/admin/ops/maintenance-jobs/registry.ts` | ✓ `backfill-order-persons` |
| Email lead import | `workflows/leads/lib/email-lead.ts` | ✓ `inbound_email` |
| Manual admin API | `api/admin/persons/route.ts` | ✗ (caller may set metadata) |
| CSV / batch import | `workflows/persons/import-person/…batch-persons.ts` | ✗ (filename discarded) |
| Partner-created contacts | `workflows/partner/add-people-partner.ts` | ✗ |

Cross-entity links: `links/partner-person.ts` (partner → `people`), no direct
customer→person link (only indirect via the order-conversion upsert).

## Gaps for the grouping epic

1. **No reliable source signal** — `metadata.source` is unindexed JSON, set by 3/6
   paths. The desired buckets (imported-file / ad-lead / customer / manual / partner)
   can only be *inferred* today (partner-link → partner; lead person_id → ad-lead;
   customer-email match → customer; `metadata.source` → order/backfill/email; else
   manual/imported).
2. **Send audience is a hard-coded 3-source union** — no way to pick "only imported"
   or "only web-form subscribers".
3. **Customers & leads bypass subscription state** — grouping must decide whether a
   group send still respects `email_subscribed`/opt-out (ties into #839).
4. **A segment model exists but is ad-planning-scoped** — decide reuse vs a leaner
   newsletter-group table.

## Suggested hook points (for the epic)
- **Provenance:** add `person.source` (enum) + a Data-Plumbing backfill that classifies
  the existing population from the best available signal (per gap #1).
- **Groups:** either reuse `CustomerSegment`/`SegmentMember` or add `audience_group` +
  membership; expose source-derived "system groups" + custom named groups.
- **Send:** extend `getSubscribersStep` to take `group_ids`/`sources`; add group
  selection to the send workflow input + admin send UI; add an audience-composition
  ("who's in here") count view.

Related: #839 (subscribe/unsubscribe), #664 (order→person), #659 marketing /
ad-planning segments, `project_659_newsletter_page_type`, `project_450_reengagement_triggers`.
