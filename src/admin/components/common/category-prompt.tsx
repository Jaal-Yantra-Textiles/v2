import { Button, Input } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "./form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const categorySchema = z.object({
  description: z.string().min(1, "Description is required"),
});

type CategoryPromptProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryName: string;
  onConfirm: (data: { description: string }) => void;
};

export const CategoryPrompt = ({
  open,
  onOpenChange,
  categoryName,
  onConfirm,
}: CategoryPromptProps) => {
  const { t } = useTranslation();
  const form = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      description: "",
    },
  });

  const handleSubmit = (data: z.infer<typeof categorySchema>) => {
    onConfirm(data);
    onOpenChange(false);
    form.reset();
  };

  const handleClose = () => {
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog modal={true} open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-ui-bg-base" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {t("taskTemplate.newCategory.title")}
          </DialogTitle>
          <p className="text-ui-fg-subtle text-sm">
            {t("taskTemplate.newCategory.description", {
              name: categoryName || "",
            })}
          </p>
        </DialogHeader>

        <div className="py-4">
          <Form.Field
            control={form.control}
            name="description"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>{t("fields.description")}</Form.Label>
                <Form.Control>
                  <DialogPrimitive.DialogTrigger asChild>
                    <Input
                      placeholder={t("taskTemplate.newCategory.descriptionPlaceholder")}
                      {...field}
                    />
                  </DialogPrimitive.DialogTrigger>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        <DialogFooter>
          <div className="flex items-center justify-end gap-x-2">
            <Button
              size="small"
              variant="secondary"
              onClick={handleClose}
              type="button"
            >
              {t("actions.cancel")}
            </Button>
            <Button 
              size="small"
              onClick={form.handleSubmit(handleSubmit)}
              type="button"
            >
              {t("actions.create")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
