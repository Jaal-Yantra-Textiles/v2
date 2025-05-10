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
