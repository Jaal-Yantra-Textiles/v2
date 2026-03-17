export enum PlanInterval {
  MONTHLY = "monthly",
  YEARLY = "yearly",
}

export enum SubscriptionStatus {
  ACTIVE = "active",
  CANCELED = "canceled",
  EXPIRED = "expired",
  PAST_DUE = "past_due",
}

export enum PaymentProvider {
  PAYU = "payu",
  STRIPE = "stripe",
  MANUAL = "manual",
}

export enum SubscriptionPaymentStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  REFUNDED = "refunded",
}
