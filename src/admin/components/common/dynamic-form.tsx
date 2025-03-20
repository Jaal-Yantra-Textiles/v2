import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Switch } from "@medusajs/ui";
import { FileUpload } from "./file-upload";
import { FieldValues, Path, useForm, type Control, type DefaultValues, type Resolver } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Form } from "./form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";
import { useEffect, useState } from "react";
import isEqual from "lodash/isEqual";

export type BaseFormType = Record<string, any>;

export type FieldConfig<T extends FieldValues> = {
  name: Path<T>;
  type: "text" | "number" | "select" | "switch" | "custom" | "file";
  label: string;
  hint?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  validation?: z.ZodType<any>;
  customComponent?: React.ComponentType<any>;
  customProps?: Record<string, any>;
  gridCols?: number;
  defaultValue?: any;
  accept?: string;
  formats?: string[];
  preview?: string;
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
  // Track if form has been modified from initial values
  const [formDirty, setFormDirty] = useState(false);
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
            // Handle string inputs for number fields and convert them properly
            fieldSchema = field.required 
              ? z.preprocess((val) => val === "" ? 0 : Number(val), z.number().min(0))
              : z.preprocess((val) => val === "" || val === null ? undefined : Number(val), z.number().optional());
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
  
  // Store original values for comparison
  const originalValues = computeDefaultValues(fields, defaultValues);
  
  // Watch all form values to detect changes
  const currentValues = form.watch();
  
  // Check if form values have changed from defaults
  useEffect(() => {
    // Deep compare current values with original values
    const hasChanged = !isEqual(currentValues, originalValues);
    setFormDirty(hasChanged);
  }, [currentValues, originalValues]);

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
        
      case "file":
        return (
          <Form.Field
            {...baseProps}
            render={({ field: { value, onChange } }) => (
              <Form.Item>
                <Form.Label>{field.label}</Form.Label>
                <Form.Control>
                  <FileUpload
                    label={`Upload ${field.label}`}
                    hint={field.hint}
                    accept={field.customProps?.accept}
                    formats={field.customProps?.formats}
                    multiple={false}
                    preview={value || field.customProps?.preview}
                    onUploaded={async (files) => {
                      // If there's a custom upload handler, call it first
                      if (field.customProps?.onUploaded) {
                        const result = await field.customProps.onUploaded(files);
                        // If the handler returns a value, use it as the form value
                        if (result) {
                          onChange(result);
                          return;
                        }
                      }
                      
                      // Default behavior - just store the URL
                      if (files?.[0]) {
                        onChange(files[0].url);
                      }
                    }}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
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
            <Button 
              size="small" 
              type="submit" 
              isLoading={isPending}
              disabled={!formDirty} // Disable when form is unchanged
              title={!formDirty ? t("form.no_changes", "No changes to save") : ""}
            >
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      ) : (
        <div className="mt-4 flex justify-end gap-x-2">
          <Button 
            size="small" 
            type="submit" 
            isLoading={isPending}
            disabled={!formDirty} // Disable when form is unchanged
            title={!formDirty ? t("form.no_changes", "No changes to save") : ""}
          >
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
