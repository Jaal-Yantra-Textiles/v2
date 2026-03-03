---
title: "Architecture"
sidebar_label: "Architecture"
sidebar_position: 1
---

# Inbound Email System Architecture

## Overview

The inbound email system is a custom Medusa 2.x module that fetches emails via IMAP, stores them, and provides a pluggable action framework for processing emails into business records.

## System Diagram

```
iCloud+ / Gmail / IMAP Provider
         │
         │ (IMAP IDLE + fetch)
         ▼
┌─────────────────────┐
│   ImapSyncService   │  src/utils/imap-sync.ts
│  (imapflow client)  │
└────────┬────────────┘
         │ ParsedEmail
         ▼
┌─────────────────────┐
│   IMAP Subscriber   │  src/subscribers/imap-sync.ts
│  (auto-start on     │
│   server boot)      │
└────────┬────────────┘
         │ createInboundEmails()
         ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  InboundEmail       │     │  Action Registry         │
│  Module + Service   │────>│  src/utils/inbound-      │
│  (MedusaService)    │     │  email-actions/index.ts   │
└────────┬────────────┘     └──────────┬───────────────┘
         │                             │
         │                    ┌────────┴────────┐
         │                    │  Actions        │
         │                    │  - create_      │
         │                    │    inventory_   │
         │                    │    order        │
         │                    │  - (future...)  │
         │                    └────────┬────────┘
         │                             │
         ▼                             ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  Admin API Routes   │     │  HTML Order Parser       │
│  /admin/inbound-    │     │  src/utils/parse-order-  │
│  emails/*           │     │  email.ts                │
└────────┬────────────┘     └──────────────────────────┘
         │
         ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  Admin UI           │     │  Inventory Order         │
│  /settings/         │────>│  Workflow                │
│  inbound-emails     │     │  (existing)              │
└─────────────────────┘     └──────────────────────────┘
```

## File Structure

```
src/
├── modules/inbound_emails/
│   ├── index.ts                          # Module(INBOUND_EMAIL_MODULE, { service })
│   ├── service.ts                        # extends MedusaService({ InboundEmail })
│   ├── models/inbound-email.ts           # DML model definition
│   └── migrations/                       # Auto-generated migration
│
├── utils/
│   ├── imap-sync.ts                      # IMAP client singleton
│   ├── parse-order-email.ts              # Regex-based HTML parser
│   └── inbound-email-actions/
│       ├── index.ts                      # Action interface + registry
│       └── create-inventory-order.ts     # First action
│
├── subscribers/imap-sync.ts              # Auto-start on server boot
├── links/inbound-email-inventory-order.ts
│
├── api/admin/inbound-emails/
│   ├── route.ts                          # GET  list
│   ├── validators.ts                     # Zod schemas
│   ├── actions/route.ts                  # GET  list actions
│   ├── sync/route.ts                     # POST manual sync
│   └── [id]/
│       ├── route.ts                      # GET  detail
│       ├── extract/route.ts              # POST extract
│       ├── execute/route.ts              # POST execute
│       └── ignore/route.ts              # POST ignore
│
└── admin/
    ├── hooks/api/inbound-emails.ts
    ├── routes/settings/inbound-emails/
    │   ├── page.tsx                       # List page
    │   └── [id]/page.tsx                  # Detail page
    └── components/inbound-emails/
        └── execute-action-dialog.tsx
```

## Key Design Decisions

### Singleton IMAP Client

The `ImapSyncService` is a singleton (`getImapSyncService()`) to ensure only one IMAP connection exists per server instance. It handles:

- Connection management with auto-reconnect (30s delay)
- IDLE listening for real-time new email notifications
- Manual `syncRecent(count)` for batch fetching
- Graceful disconnect on shutdown

### Subscriber-Based Auto-Start

The IMAP connection starts via a Medusa subscriber listening to a boot-time event. This ensures:

- The connection starts only after the container is fully initialized
- Services are resolvable from the container when `onNewEmail` fires
- A `started` guard prevents duplicate connections

### Deduplication

Emails are deduplicated by `imap_uid` + `folder`. Before storing, the sync route checks for existing records with the same UID. The IDLE listener trusts the "exists" event count, so duplicates from IDLE are rare.

### Action Framework Separation

Actions are decoupled from the module via a registry pattern. This means:

- New actions can be added without modifying existing code
- Actions are registered via side-effect imports
- The API routes dynamically list available actions from the registry
- Each action defines its own `extract()` and `execute()` logic

### List vs Detail Field Selection

The list endpoint (`GET /admin/inbound-emails`) deliberately excludes heavy fields (`html_body`, `text_body`, `extracted_data`, `action_result`) for performance. These are only returned by the detail endpoint (`GET /admin/inbound-emails/:id`).

## Module Link

The `InboundEmail <> InventoryOrder` link (many-to-many) allows querying which inventory orders were created from which emails, and vice versa. This is defined in `src/links/inbound-email-inventory-order.ts`.
