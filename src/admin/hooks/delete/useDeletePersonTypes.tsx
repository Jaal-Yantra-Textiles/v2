import { toast, usePrompt } from "@medusajs/ui";
import { useDeletePersonType } from "../api/persontype";

export const useDeletePersonTypeAction = (id: string) => {
  const prompt = usePrompt();
  if (!id || typeof id !== "string") {
    throw new Error("Invalid ID provided. ID must be a non-empty string.");
  }
  const { mutateAsync } = useDeletePersonType(id, {
    onSuccess: () => {
      toast.success(
        "Person Type deleted that means something else is going on in your mind",
      );
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const handleDelete = async () => {
    const result = await prompt({
      title: "Are you sure?",
      description:
        "You are about to delete the person type and might affect the relationship that its associated with",
      confirmText: "Yes delete",
      cancelText: "Cancel",
    });

    if (!result) {
      return;
    }

    await mutateAsync();
  };

  return handleDelete;
};
