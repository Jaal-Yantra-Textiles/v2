import { Heading, Input, Select, Text, Textarea } from "@medusajs/ui";
import { Control } from "react-hook-form";
import { Form } from "../../common/form";

interface TemplateType {
  label: string;
  value: string;
}

interface BasicStepProps {
  control: Control<any>;
  templateTypes: TemplateType[];
}

export const BasicStep = ({ control, templateTypes }: BasicStepProps) => {
  return (
    <div className="flex flex-col gap-y-6 p-6">
      <div>
        <Heading level="h2">Basic Information</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Set up the basic details for your email template
        </Text>
      </div>

      <div className="grid gap-y-6">
        <Form.Field
          control={control}
          name="name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Template Name</Form.Label>
              <Form.Control>
                <Input {...field} placeholder="Welcome Email Template" />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="description"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Description</Form.Label>
              <Form.Control>
                <Textarea {...field} placeholder="Brief description of the template..." />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <Form.Field
            control={control}
            name="template_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Template Key</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="welcome_email_v1" />
                </Form.Control>
                <Form.ErrorMessage />
                <Form.Hint>Unique identifier for this template</Form.Hint>
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="template_type"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Template Type</Form.Label>
                <Form.Control>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <Select.Trigger>
                      <Select.Value placeholder="Select template type" />
                    </Select.Trigger>
                    <Select.Content>
                      {templateTypes.map((type) => (
                        <Select.Item key={type.value} value={type.value}>
                          {type.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>
      </div>
    </div>
  );
};
