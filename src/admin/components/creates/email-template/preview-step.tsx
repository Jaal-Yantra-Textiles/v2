import { Heading, Text } from "@medusajs/ui";
import { UseFormWatch } from "react-hook-form";

interface PreviewStepProps {
  watch: UseFormWatch<any>;
}

export const PreviewStep = ({ watch }: PreviewStepProps) => {
  return (
    <div className="flex flex-col gap-y-6 p-6">
      <div>
        <Heading level="h2">Template Preview</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Review your email template before creating
        </Text>
      </div>

      <div className="grid gap-y-6">
        <div className="border rounded-lg p-4">
          <Text weight="plus" size="small" className="mb-2">Template Details</Text>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Text className="text-ui-fg-subtle">Name:</Text>
              <Text>{watch("name") || "—"}</Text>
            </div>
            <div>
              <Text className="text-ui-fg-subtle">Type:</Text>
              <Text>{watch("template_type") || "—"}</Text>
            </div>
            <div>
              <Text className="text-ui-fg-subtle">From:</Text>
              <Text>{watch("from") || "—"}</Text>
            </div>
            <div>
              <Text className="text-ui-fg-subtle">Key:</Text>
              <Text className="font-mono text-xs">{watch("template_key") || "—"}</Text>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <Text weight="plus" size="small" className="mb-2">Email Preview</Text>
          <div className="bg-ui-bg-subtle rounded p-4">
            <div className="mb-3 pb-3 border-b">
              <Text weight="plus">Subject: {watch("subject") || "No subject"}</Text>
            </div>
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ 
                __html: watch("html_content") || "<p>No content</p>" 
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
