import { z } from "@medusajs/framework/zod";

export const FeedbackSchema = z.object({
  rating: z.enum(["one","two","three","four","five"]),
  comment: z.string().optional(),
  status: z.enum(["pending","reviewed","resolved"]),
  submitted_by: z.string(),
  submitted_at: z.coerce.date(),
  reviewed_by: z.string().optional(),
  reviewed_at: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

export const UpdateFeedbackSchema = z.object({
  rating: z.enum(["one","two","three","four","five"]).optional(),
  comment: z.string().optional(),
  status: z.enum(["pending","reviewed","resolved"]).optional(),
  submitted_by: z.string().optional(),
  submitted_at: z.coerce.date().optional(),
  reviewed_by: z.string().optional(),
  reviewed_at: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateFeedback = z.infer<typeof UpdateFeedbackSchema>;
