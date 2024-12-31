import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdminPersonType } from "../person-type/person-type-general-section";
import { useUpdatePersonType } from "../../hooks/api/persontype";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";

const EditPersonTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

type EditPersonTypeFormProps = {
  personType: AdminPersonType;
};

export const EditPersonTypeForm = ({ personType }: EditPersonTypeFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();

  const form = useForm<z.infer<typeof EditPersonTypeSchema>>({
    defaultValues: {
      name: personType.name,
      description: personType.description,
    },
    resolver: zodResolver(EditPersonTypeSchema),
  });

  const { mutateAsync, isPending } = useUpdatePersonType(personType.id);

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        name: data.name,
        description: data.description,
      },
      {
        onSuccess: ({ personType }) => {
          toast.success(
            t("productTypes.edit.successToast", {
              value: personType.name,
            }),
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      },
    );
  });

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          <Form.Field
            control={form.control}
            name="name"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>{t("productTypes.fields.value")}</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              );
            }}
          />
          <Form.Field
            control={form.control}
            name="description"
            render={({ field }) => {
              return (
                <Form.Item>
                  <Form.Label>{t("productTypes.fields.value")}</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              );
            }}
          />
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  );
};
