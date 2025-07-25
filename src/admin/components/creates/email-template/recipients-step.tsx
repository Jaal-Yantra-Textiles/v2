import { Heading, Input, Text } from "@medusajs/ui";
import { Control } from "react-hook-form";
import { Form } from "../../common/form";

interface RecipientsStepProps {
  control: Control<any>;
}

export const RecipientsStep = ({ control }: RecipientsStepProps) => {
  return (
    <div className="flex flex-col gap-y-6 p-6">
      <div>
        <Heading level="h2">Email Recipients</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Configure the sender and recipient settings for this template
        </Text>
      </div>

      <div className="grid gap-y-6">
        <Form.Field
          control={control}
          name="from"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>From Email</Form.Label>
              <Form.Control>
                <Input {...field} placeholder="noreply@company.com" type="email" />
              </Form.Control>
              <Form.ErrorMessage />
              <Form.Hint>The sender email address for this template</Form.Hint>
            </Form.Item>
          )}
        />

        <div className="grid grid-cols-3 gap-4">
          <Form.Field
            control={control}
            name="to"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>To (Optional)</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="user@example.com" type="email" />
                </Form.Control>
                <Form.ErrorMessage />
                <Form.Hint>Default recipient (can be overridden when sending)</Form.Hint>
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="cc"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>CC (Optional)</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="cc@example.com" type="email" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="bcc"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>BCC (Optional)</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="bcc@example.com" type="email" />
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
