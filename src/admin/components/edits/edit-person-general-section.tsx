import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { DatePicker } from "@medusajs/ui";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdatePerson} from "../../hooks/api/persons";
import { AdminPerson } from "../../hooks/api/personandtype";
import { useFileUpload } from "../../hooks/api/upload";
import { useState } from "react";

const personSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email format"),
  date_of_birth: z.date().nullable(),
  avatar: z.string().optional(),
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
  const { mutateAsync: uploadFile } = useFileUpload();
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(person.avatar);

  const handleSubmit = async (data: PersonFormData) => {
    await mutateAsync(
      {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        date_of_birth: data.date_of_birth,
        avatar: data.avatar,
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
      name: "avatar",
      type: "file",
      label: t("fields.avatar", "Avatar"),
      gridCols: 1,
      customProps: {
        accept: "image/*",
        formats: [".jpg", ".jpeg", ".png", ".gif"],
        preview: previewUrl,
        onUploaded: async (files: { file: File; url: string }[]) => {
          if (!files?.length) return;
          
          try {
            const { file, url: tempPreviewUrl } = files[0];
            
            // Set temporary preview URL from the dropped/selected file
            setPreviewUrl(tempPreviewUrl);
            
            const uploadResponse = await uploadFile({
              files: [file],
            });
            
            if (uploadResponse.files?.[0]) {
              const avatarUrl = uploadResponse.files[0].url;
              // The URL will be stored in the form value when the user saves
              setPreviewUrl(avatarUrl);
              toast.success(t("persons.edit.avatarUploaded", { 
                defaultValue: "Avatar uploaded successfully" 
              }));
              return avatarUrl;
            }
          } catch (error) {
            toast.error(t("persons.edit.avatarUploadError", { 
              defaultValue: "Failed to upload avatar" 
            }));
          }
        }
      }
    },
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
        avatar: person.avatar || "",
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
