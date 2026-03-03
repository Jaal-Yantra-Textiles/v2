---
title: "Inbound Email Setup"
sidebar_label: "Setup"
sidebar_position: 1
---

# Inbound Email Setup

The inbound email system fetches emails from an IMAP mailbox (e.g. iCloud+ custom domain), stores them, and lets you process them into inventory orders or other records.

## Prerequisites

- JYT Commerce API running with the `inbound_emails` module registered
- An IMAP-accessible email account (iCloud+, Gmail, or any provider)

## 1. Configure Environment Variables

Add the following to your `.env`:

```bash
IMAP_HOST=imap.mail.me.com
IMAP_PORT=993
IMAP_USER=orders@yourdomain.com
IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx
IMAP_TLS=true
IMAP_MAILBOX=INBOX
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAP_HOST` | Yes | — | IMAP server hostname |
| `IMAP_PORT` | No | `993` | IMAP server port |
| `IMAP_USER` | Yes | — | Email account username |
| `IMAP_PASSWORD` | Yes | — | Email account password or app-specific password |
| `IMAP_TLS` | No | `true` | Use TLS encryption |
| `IMAP_MAILBOX` | No | `INBOX` | Folder to monitor |

:::info
If these variables are not set, the IMAP listener won't start but the rest of the system (API routes, admin UI) still works. You can create inbound email records manually via the service.
:::

## 2. iCloud+ Custom Domain Setup

If using iCloud+ with a custom domain:

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**
2. Click **Generate an app-specific password** and name it "JYT IMAP"
3. Copy the generated password — use it as `IMAP_PASSWORD`
4. Set `IMAP_HOST=imap.mail.me.com`
5. Use your custom domain email as `IMAP_USER` (e.g. `orders@yourdomain.com`)

:::caution
Do **not** use your Apple ID password directly. iCloud requires app-specific passwords for third-party IMAP access.
:::

## 3. Run Database Migration

If this is a fresh setup:

```bash
pnpm medusa db:generate inbound_emails
pnpm medusa db:migrate
```

## 4. Start the Server

```bash
yarn dev
```

On startup, the server logs will show:

```
[IMAP] Connected to imap.mail.me.com
[IMAP] Sync started, listening for new emails
```

Or, if IMAP is not configured:

```
[IMAP] Not configured (IMAP_HOST/IMAP_USER/IMAP_PASSWORD missing), skipping
```

## 5. Verify

1. Open the admin panel and navigate to **Settings → Inbound Emails**
2. Click **Sync Now** to fetch recent emails
3. You should see emails appear in the table

---

## Gmail Setup

For Gmail accounts:

1. Enable **2-Step Verification** in your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Generate an app password for "Mail"
4. Configure:

```bash
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=yourname@gmail.com
IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx
IMAP_TLS=true
IMAP_MAILBOX=INBOX
```

## Other IMAP Providers

Any standard IMAP provider works. Common hosts:

| Provider | Host | Port |
|----------|------|------|
| iCloud+ | `imap.mail.me.com` | 993 |
| Gmail | `imap.gmail.com` | 993 |
| Outlook | `outlook.office365.com` | 993 |
| Yahoo | `imap.mail.yahoo.com` | 993 |
| Fastmail | `imap.fastmail.com` | 993 |
