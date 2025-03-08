import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DatePicker } from "@medusajs/ui";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdatePerson} from "../../hooks/api/persons";
import { AdminPerson } from "../../hooks/api/personandtype";

const personSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email format"),
  date_of_birth: z.date().nullable(),
});

type PersonFormData = z.infer<typeof personSchema>;

const DatePickerField = ({ value, onChange }: any) => (
  <DatePicker
    value={value}
    onChange={(date) => {
      onChange(date);
    }}
  />
);

type EditPersonGeneralSectionProps = {
  person: AdminPerson;
};

export const EditPersonGeneralSection = ({ person }: EditPersonGeneralSectionProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdatePerson(person.id);

  const handleSubmit = async (data: PersonFormData) => {
    await mutateAsync(
      {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        date_of_birth: data.date_of_birth,
      },
      {
        onSuccess: ({ person }) => {
          toast.success(
            t("persons.updateSuccess", {
              name: `${person.first_name} ${person.last_name}`,
            })
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  };

  const fields: FieldConfig<PersonFormData>[] = [
    {
      name: "first_name",
      type: "text",
      label: t("fields.firstName"),
      required: true,
      gridCols: 1
    },
    {
      name: "last_name",
      type: "text",
      label: t("fields.lastName"),
      required: true,
      gridCols: 1
    },
    {
      name: "email",
      type: "text",
      label: t("fields.email"),
      required: true,
      gridCols: 1
    },
    {
      name: "date_of_birth",
      type: "custom",
      label: t("fields.dateOfBirth"),
      customComponent: DatePickerField,
      gridCols: 1
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        first_name: person.first_name,
        last_name: person.last_name,
        email: person.email,
        date_of_birth: person.date_of_birth ? new Date(person.date_of_birth) : null,
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
