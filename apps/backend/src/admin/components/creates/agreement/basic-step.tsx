import { Heading, Input, Select, Text, DatePicker } from "@medusajs/ui";
import { Control } from "react-hook-form";
import { Form } from "../../common/form";

type AgreementFormData = {
  title: string;
  status: string;
  subject: string;
  template_key?: string;
  valid_from?: string;
  valid_until?: string;
  from_email?: string;
  content: string;
};

type BasicStepProps = {
  control: Control<AgreementFormData>;
};

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

export const AgreementBasicStep = ({ control }: BasicStepProps) => {
  return (
    <div className="flex flex-col gap-y-8 p-6">
      <div>
        <Heading level="h2">General Information</Heading>
        <Text className="text-ui-fg-subtle">
          Set up the basic details for your agreement
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Form.Field
          control={control}
          name="title"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Title</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  placeholder="Enter agreement title"
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="status"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Status</Form.Label>
              <Form.Control>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select status" />
                  </Select.Trigger>
                  <Select.Content>
                    {statusOptions.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="subject"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Subject</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  placeholder="Email subject when sending"
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="template_key"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Template Key</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  placeholder="Reference key for this agreement"
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="valid_from"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Valid From</Form.Label>
              <Form.Control>
                <DatePicker 
                  value={field.value ? new Date(field.value) : undefined}
                  onChange={(date) => field.onChange(date?.toISOString().split('T')[0] || "")}
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="valid_until"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Valid Until</Form.Label>
              <Form.Control>
                <DatePicker 
                  value={field.value ? new Date(field.value) : undefined}
                  onChange={(date) => field.onChange(date?.toISOString().split('T')[0] || "")}
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={control}
          name="from_email"
          render={({ field }) => (
            <Form.Item className="md:col-span-2">
              <Form.Label optional>From Email</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  type="email"
                  placeholder="sender@example.com"
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>
    </div>
  );
};
