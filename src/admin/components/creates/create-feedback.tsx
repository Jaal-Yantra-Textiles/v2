import { toast } from "sonner";
import { z } from "zod";
import { useMemo } from "react";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useCreateFeedback } from "../../hooks/api/feedbacks";
import { useUsers } from "../../hooks/api/users";

const ratingOptions = [
  { value: "one", label: "⭐ 1 Star" },
  { value: "two", label: "⭐⭐ 2 Stars" },
  { value: "three", label: "⭐⭐⭐ 3 Stars" },
  { value: "four", label: "⭐⭐⭐⭐ 4 Stars" },
  { value: "five", label: "⭐⭐⭐⭐⭐ 5 Stars" },
];

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "resolved", label: "Resolved" },
];

type FeedbackFormData = {
  rating: "one" | "two" | "three" | "four" | "five";
  comment?: string;
  status: "pending" | "reviewed" | "resolved";
  submitted_by: string;
  reviewed_by?: string;
};

export const CreateFeedbackForm = () => {
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useCreateFeedback();
  const { users } = useUsers();

  // Transform users into select options
  const userOptions = useMemo(() => {
    if (!users) return [];
    return users.map((user) => ({
      value: user.email || user.id,
      label: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email || user.id,
    }));
  }, [users]);

  const handleSubmit = async (data: FeedbackFormData) => {
    // Ensure submitted_by has a value
    if (!data.submitted_by || data.submitted_by.trim() === "") {
      toast.error("Submitted by field is required");
      return;
    }

    await mutateAsync(
      {
        rating: data.rating,
        comment: data.comment || undefined,
        status: data.status || "pending",
        submitted_by: data.submitted_by,
        submitted_at: new Date(),
        reviewed_by: data.reviewed_by || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Feedback created successfully");
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  };

  const feedbackValidation = z.object({
    rating: z.enum(["one", "two", "three", "four", "five"]),
    comment: z.string().optional(),
    status: z.enum(["pending", "reviewed", "resolved"]),
    submitted_by: z.string().min(1, "Submitted by is required"),
    reviewed_by: z.string().optional(),
  });

  const fields: FieldConfig<FeedbackFormData>[] = [
    {
      name: "rating",
      label: "Rating",
      type: "select",
      options: ratingOptions,
      required: true,
    },
    {
      name: "comment",
      label: "Comment",
      type: "text",
      hint: "Enter your feedback comment",
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: statusOptions,
      defaultValue: "pending",
    },
    {
      name: "submitted_by",
      label: "Submitted By",
      type: "select",
      options: userOptions,
      hint: "Select the user submitting this feedback",
      required: true,
    },
    {
      name: "reviewed_by",
      label: "Reviewed By",
      type: "select",
      options: userOptions,
      hint: "Select the reviewer (optional)",
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      onSubmit={handleSubmit}
      customValidation={feedbackValidation}
      defaultValues={{
        status: "pending" as const,
      }}
      isPending={isPending}
    />
  );
};
