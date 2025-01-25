import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Switch } from "@medusajs/ui";
import { FieldValues, Path, useForm, type Control, type DefaultValues, type Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Form } from "./form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";

export type BaseFormType = Record<string, any>;

export type FieldConfig<T extends FieldValues> = {
  name: Path<T>;
  type: "text" | "number" | "select" | "switch" | "custom";
  label: string;
  hint?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  validation?: z.ZodType<any>;
  customComponent?: React.ComponentType<any>;
  customProps?: Record<string, any>;
  gridCols?: number;
  defaultValue?: any;
};

export type FormConfig<T extends FieldValues> = {
  fields: FieldConfig<T>[];
  defaultValues?: DefaultValues<T>;
  onSubmit: (data: T) => Promise<void>;
  customValidation?: z.ZodType<T>;
  layout?: {
    showDrawer?: boolean;
    gridCols?: number;
  };
  isPending?: boolean;
};

export const DynamicForm = <T extends FieldValues>({
  fields,
  defaultValues,
  onSubmit,
  customValidation,
  layout = { showDrawer: true, gridCols: 1 },
  isPending = false,
}: FormConfig<T>) => {
  const { t } = useTranslation();

  // Build schema from fields
  const generateSchema = () => {
    const schemaFields: Record<string, z.ZodType<any>> = {};
    
    fields.forEach((field) => {
      let fieldSchema: z.ZodType<any>;
      
      if (field.validation) {
        fieldSchema = field.validation;
      } else {
        switch (field.type) {
          case "text":
            fieldSchema = field.required ? z.string().min(1) : z.string().optional();
            break;
          case "number":
            fieldSchema = field.required ? z.number().min(0) : z.number().optional();
            break;
          case "select":
            fieldSchema = field.required 
              ? z.enum(field.options?.map(o => o.value) as [string, ...string[]])
              : z.enum(field.options?.map(o => o.value) as [string, ...string[]]).optional();
            break;
          case "switch":
            fieldSchema = z.boolean();
            break;
          default:
            fieldSchema = z.any();
        }
      }
      
      schemaFields[field.name] = fieldSchema;
    });

    return customValidation || z.object(schemaFields);
  };

  const computeDefaultValues = <T extends FieldValues>(
    fields: Array<{ name: Path<T>; defaultValue?: any }>,
    defaultValues?: DefaultValues<T>
  ): DefaultValues<T> => {
    return fields.reduce<DefaultValues<T>>(
      (acc, field) => ({
        ...acc,
        [field.name]: field.defaultValue ?? 
          (defaultValues && field.name in defaultValues ? defaultValues[field.name as Path<T>] : ""),
      }),
      {} as DefaultValues<T>
    );
  };

  const form = useForm<T>({
    resolver: zodResolver(generateSchema()) as Resolver<T>,
    defaultValues: computeDefaultValues(fields, defaultValues),
  });

  const renderField = (field: FieldConfig<T>) => {
    const baseProps = {
      key: field.name,
      control: form.control as Control<T>,
      name: field.name,
    };

    if (field.type === "custom" && field.customComponent) {
      const CustomComponent = field.customComponent;
      return (
        <Form.Field
          {...baseProps}
          render={({ field: formField }) => (
            <Form.Item>
              <Form.Label>{field.label}</Form.Label>
              <Form.Control>
                <CustomComponent {...formField} {...field.customProps} />
              </Form.Control>
              <Form.ErrorMessage />
              {field.hint && <Form.Hint>{field.hint}</Form.Hint>}
            </Form.Item>
          )}
        />
      );
    }

    switch (field.type) {
      case "text":
        return (
          <Form.Field
            {...baseProps}
            render={({ field: formField }) => (
              <Form.Item>
                <Form.Label>{field.label}</Form.Label>
                <Form.Control>
                  <Input {...formField} value={formField.value || ""} />
                </Form.Control>
                <Form.ErrorMessage />
                {field.hint && <Form.Hint>{field.hint}</Form.Hint>}
              </Form.Item>
            )}
          />
        );

      case "number":
        return (
          <Form.Field
            {...baseProps}
            render={({ field: formField }) => (
              <Form.Item>
                <Form.Label>{field.label}</Form.Label>
                <Form.Control>
                  <Input
                    type="number"
                    autoComplete="off"
                    {...formField}
                    onChange={(e) => formField.onChange(Number(e.target.value))}
                  />
                </Form.Control>
                <Form.ErrorMessage />
                {field.hint && <Form.Hint>{field.hint}</Form.Hint>}
              </Form.Item>
            )}
          />
        );

      case "select":
        return (
          <Form.Field
            {...baseProps}
            render={({ field: { value, onChange, ...rest } }) => (
              <Form.Item>
                <Form.Label>{field.label}</Form.Label>
                <Form.Control>
                  <Select value={value} onValueChange={onChange} {...rest}>
                    <Select.Trigger>
                      <Select.Value placeholder={`Select ${field.label.toLowerCase()}`} />
                    </Select.Trigger>
                    <Select.Content>
                      {field.options?.map((option) => (
                        <Select.Item key={option.value} value={option.value}>
                          {option.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
                {field.hint && <Form.Hint>{field.hint}</Form.Hint>}
              </Form.Item>
            )}
          />
        );

      case "switch":
        return (
          <Form.Field
            {...baseProps}
            render={({ field: { value, onChange } }) => (
              <div className="flex items-center justify-between">
                <div>
                  <Form.Label>{field.label}</Form.Label>
                  {field.hint && <Form.Hint>{field.hint}</Form.Hint>}
                </div>
                <Switch checked={value} onCheckedChange={onChange} />
              </div>
            )}
          />
        );

      default:
        return null;
    }
  };

  const formContent = (
    <KeyboundForm
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-1 flex-col overflow-hidden"
    >
      {layout.showDrawer ? (
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          {fields.map((field) => (
            <div
              key={field.name}
              className={field.gridCols ? `col-span-${field.gridCols}` : ""}
            >
              {renderField(field)}
            </div>
          ))}
        </RouteDrawer.Body>
      ) : (
        <div className="flex flex-1 flex-col gap-y-8">
          {fields.map((field) => (
            <div
              key={field.name}
              className={field.gridCols ? `col-span-${field.gridCols}` : ""}
            >
              {renderField(field)}
            </div>
          ))}
        </div>
      )}
      
      {layout.showDrawer ? (
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
      ) : (
        <div className="mt-4 flex justify-end gap-x-2">
          <Button size="small" type="submit" isLoading={isPending}>
            {t("actions.save")}
          </Button>
        </div>
      )}
    </KeyboundForm>
  );

  return layout.showDrawer ? (
    <RouteDrawer.Form form={form}>{formContent}</RouteDrawer.Form>
  ) : (
    formContent
  );
};
