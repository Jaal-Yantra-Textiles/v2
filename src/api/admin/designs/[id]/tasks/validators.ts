import { z } from "zod"

const dateTransformer = (val: any) => {
  if (typeof val === "string") {
    const date = new Date(val)
    if (isNaN(date.getTime())) {
      throw new Error("Invalid date format")
    }
    return date
  }
  return val
}

export const AdminPostDesignTasksReq = z.object({
  template_names: z.array(z.string()).min(1, "At least one template name is required")
})

export type AdminPostDesignTasksReqType = z.infer<typeof AdminPostDesignTasksReq>
