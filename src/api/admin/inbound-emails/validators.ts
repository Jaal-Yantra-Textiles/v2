import { z } from "@medusajs/framework/zod"

export const listInboundEmailsQuerySchema = z.object({
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20)
  ),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(0).default(0)
  ),
  q: z.string().optional(),
  status: z.enum(["received", "action_pending", "processed", "ignored"]).optional(),
  from_address: z.string().optional(),
  folder: z.string().optional(),
})

export type ListInboundEmailsQuery = z.infer<typeof listInboundEmailsQuerySchema>

export const extractInboundEmailSchema = z.object({
  action_type: z.string().min(1, "action_type is required"),
})

export type ExtractInboundEmailBody = z.infer<typeof extractInboundEmailSchema>

export const executeInboundEmailSchema = z.object({
  action_type: z.string().min(1, "action_type is required"),
  params: z.record(z.unknown()),
})

export type ExecuteInboundEmailBody = z.infer<typeof executeInboundEmailSchema>

export const testConnectionSchema = z.object({
  host: z.string().min(1, "host is required"),
  port: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(65535).default(993)
  ),
  user: z.string().min(1, "user is required"),
  password: z.string().min(1, "password is required"),
  tls: z.boolean().default(true),
  mailbox: z.string().default("INBOX"),
})

export type TestConnectionBody = z.infer<typeof testConnectionSchema>

export const syncInboundEmailsSchema = z.object({
  count: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(500).default(50)
  ),
})

export type SyncInboundEmailsBody = z.infer<typeof syncInboundEmailsSchema>
