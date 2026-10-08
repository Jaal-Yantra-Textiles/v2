/**
 * Types for the send-blog-subscribers workflow
 */

/**
 * Represents a subscriber with email information
 */
export interface Subscriber {
  id: string
  email: string
  first_name?: string
  last_name?: string
  [key: string]: any
}

/**
 * Input for the send-blog-subscribers workflow
 */
export interface SendBlogSubscribersInput {
  page_id: string
  subject: string
  customMessage?: string
  /** Test sends only: a draft may be emailed to the founder before publishing. */
  allow_unpublished?: boolean
}

/**
 * Input for the test-blog-email workflow
 */
export interface TestBlogEmailInput {
  page_id: string
  test_email: string
  subject: string
  customMessage?: string
  /** A real reader to send the post to by hand (a catch-up for someone who
   *  missed the broadcast): greeted by name, with their own unsubscribe link.
   *  Without it the send is a preview to "Test User". */
  recipient?: { id: string; first_name?: string | null; last_name?: string | null }
}

/**
 * Result of the email sending process
 */
export interface EmailSendingResult {
  success: boolean
  subscriber_id: string
  email: string
  error?: string
}

/**
 * Result of the test email sending process
 */
export interface TestEmailResult {
  success: boolean
  email: string
  error?: string
}

/**
 * Batch of subscribers to process
 */
export interface SubscriberBatch {
  subscribers: Subscriber[]
  blogData: any
  emailConfig: {
    subject: string
    customMessage?: string
  }
}

/**
 * Summary of the email sending process
 */
export interface SendingSummary {
  totalSubscribers: number
  sentCount: number
  failedCount: number
  queuedCount?: number
  sentList: {
    subscriber_id: string
    email: string
  }[]
  failedList: {
    subscriber_id: string
    email: string
    error: string
  }[]
  sentAt?: string
}

/**
 * Status of the blog sending process
 */
export enum BlogSendingStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed"
}
