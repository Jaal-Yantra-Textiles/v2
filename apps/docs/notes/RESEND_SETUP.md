# Resend Email Service Setup

This document explains how to set up and use the Resend email service that has been implemented to replace SendGrid.

## Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Resend Configuration
RESEND_API_KEY=your_resend_api_key_here
RESEND_FROM_EMAIL=your_verified_email@yourdomain.com
```

### Getting Your Resend API Key

1. Create an account at [Resend](https://resend.com)
2. Go to your dashboard and navigate to API Keys
3. Create a new API key and copy it to your `.env` file

### Setting Up Your From Email

For development, you can use `onboarding@resend.dev` which is provided by Resend for testing purposes:

```bash
RESEND_FROM_EMAIL=onboarding@resend.dev
```

For production, you'll need to verify your domain:

1. Go to Domains in your Resend dashboard
2. Click "Add Domain"
3. Enter your domain name and select a region
4. Add the provided DNS records to your domain
5. Click "Verify DNS Records"
6. Once verified, you can use any email address from your domain

## Configuration

The Resend email service is configured in:

- **Production**: `medusa-config.prod.ts` - Uses Resend provider
- **Development**: `medusa-config.dev.ts` - Uses local provider (logs to console)
- **Main**: `medusa-config.ts` - Uses local provider (logs to console)

## Usage

### Using Workflows (Recommended MedusaJS v2 Pattern)

```typescript
import { sendNotificationEmailWorkflow, sendOrderConfirmationWorkflow } from "../workflows/email/send-notification-email"

// Send custom notification
await sendNotificationEmailWorkflow.run({
  to: "customer@example.com",
  template: "general",
  data: {
    title: "Custom Notification",
    message: "Your custom message here",
    data: { additional: "data" }
  }
})

// Send order confirmation
await sendOrderConfirmationWorkflow(container).run({
  input: {
    orderId: "order_123"
  }
})
```

### Using Subscribers (Event-Driven Emails)

Create subscribers to automatically send emails when events occur:

```typescript
// src/subscribers/order-placed.ts
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderConfirmationWorkflow } from "../workflows/email/send-notification-email"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await sendOrderConfirmationWorkflow(container).run({
    input: {
      orderId: data.id,
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
```

### Direct Notification Service Usage

```typescript
import { Modules } from "@medusajs/framework/utils"

// In a workflow step
const notificationService = container.resolve(Modules.NOTIFICATION)

await notificationService.createNotifications({
  to: "customer@example.com",
  channel: "email",
  template: "order-placed",
  data: {
    order: orderData,
    customer: customerData
  }
})
```

## Available Templates

The following email templates are available:

1. **order-placed** - Order confirmation email
2. **order-shipped** - Order shipped notification
3. **order-canceled** - Order cancellation notification
4. **customer-created** - Welcome email for new customers
5. **password-reset** - Password reset email
6. **general** - General purpose notification template

## Template Variables

Templates support variable substitution using `{{variable_name}}` syntax:

- **password-reset**: `{{reset_url}}`
- **customer-created**: `{{customer_name}}`
- **general**: `{{title}}`, `{{message}}`, and any custom data

## Customizing Templates

You can add custom templates by:

1. Adding them to `src/modules/resend/templates/index.ts`
2. Updating the `Templates` enum in `src/modules/resend/service.ts`
3. Adding the template to the `templates` object
4. Adding a subject case in `getTemplateSubject` method

## Testing

In development mode, emails will be logged to the console instead of being sent. To test actual email sending, temporarily switch to the production configuration or create a test environment with Resend configured.

## Migration from SendGrid

The SendGrid configuration has been completely replaced with Resend. The old environment variables (`SENDGRID_API_KEY`, `SENDGRID_FROM`) are no longer needed and can be removed from your environment files.
