import { z } from "zod";

/**
 * Validator for assigning a task to a partner
 * The partnerId comes from the URL params, so we don't need it in the body
 */
export const AdminPostPartnerTaskAssignReq = z.object({
    taskId: z.string().optional(), // Optional since it comes from URL params
});

export type AdminPostPartnerTaskAssignReq = z.infer<typeof AdminPostPartnerTaskAssignReq>;
