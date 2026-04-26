import { Text, Button, Heading, ProgressTabs, Textarea, Input } from "@medusajs/ui";
import { useState, useCallback } from 'react';
import { AdminEmailTemplate, useUpdateEmailTemplate } from "../../hooks/api/email-templates";
import { useParams } from "react-router-dom";
import { toast } from "@medusajs/ui";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { VariablesModal } from "../creates/email-template/variables-modal";
import { useForm } from "react-hook-form";
import { useFieldArray } from "react-hook-form";
import { X } from "lucide-react";

interface EmailTemplateEditorSectionProps {
  emailTemplate: AdminEmailTemplate
}

// Default/sample values for variables
const sampleValues: Record<string, string> = {
  first_name: "John",
  last_name: "Doe",
  email: "john.doe@example.com",
  company: "Acme Corp",
  order_number: "ORD-2024-001",
  total: "$99.99",
  date: new Date().toLocaleDateString(),
  website_url: "https://example.com",
  current_year: new Date().getFullYear().toString(),
  agreement_title: "Service Agreement",
  agreement_content: "Please review and sign the attached agreement",
  agreement_subject: "Important: Agreement Review Required",
  agreement_id: "AGR-2024-001",
  person_id: "PERSON-123",
  response_id: "RESP-456",
  agreement_url: "https://example.com/agreement/AGR-2024-001?token=abc123"
};

// Substitute variables with sample values
const substituteVariables = (text: string, vars: any[]) => {
  if (!text || !vars || vars.length === 0) return text;
  
  let substitutedText = text;
  
  // Process each variable
  vars.forEach((variable) => {
    let key: string;
    if (typeof variable === 'string') {
      key = variable;
    } else if (typeof variable === 'object' && variable.key) {
      key = variable.key;
    } else if (typeof variable === 'object' && variable.name) {
      key = variable.name;
    } else {
      key = String(variable);
    }
    
    const value = sampleValues[key] || `{{${key}}}`;
    
    // Replace both {{variable}} and {variable} formats
    substitutedText = substitutedText
      .replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
      .replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  });
  
  return substitutedText;
};

export function EmailTemplateEditorSection({ 
  emailTemplate
}: EmailTemplateEditorSectionProps) {
  const [subject, setSubject] = useState(emailTemplate.subject || "");
  const [htmlContent, setHtmlContent] = useState(emailTemplate.html_content || "");
  const [activeTab, setActiveTab] = useState("content");
  const [isSaving, setIsSaving] = useState(false);
  const { id } = useParams<{ id: string }>();
  
  const updateEmailTemplate = useUpdateEmailTemplate(emailTemplate.id || id!);


  // Log email template variables for debugging
  console.log('Email template variables:', emailTemplate.variables);
  
  // Form setup for variables
  const { control } = useForm({
    defaultValues: {
      variables: emailTemplate.variables && typeof emailTemplate.variables === 'object' && !Array.isArray(emailTemplate.variables)
        ? Object.entries(emailTemplate.variables).map(([key, value]) => ({
            key,
            value: String(value || '')
          }))
        : Array.isArray(emailTemplate.variables) 
        ? emailTemplate.variables.map((v: any) => {
            console.log('Processing variable:', v);
            return typeof v === 'string' ? { key: v, value: '' } : { key: v.key || '', value: v.value || '' }
          })
        : []
    }
  });

  const { fields: variables, append, remove } = useFieldArray({
    control,
    name: "variables"
  });

  const getSampleValue = useCallback((key: string) => {
    return sampleValues[key] || `{{${key}}}`;
  }, []);

  const getPreviewContent = useCallback(() => {
    let previewContent = htmlContent;
    
    variables.forEach((variable: any) => {
      const key = variable.key;
      const value = variable.value || getSampleValue(key);
      
      if (key) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        previewContent = previewContent.replace(regex, value);
      }
    });

    return previewContent;
  }, [htmlContent, variables]);

  const getVariablesUsed = useCallback(() => {
    const extractedVariables: { key: string; value: string }[] = [];
    
    variables.forEach((variable: any) => {
      const key = variable.key;
      const value = variable.value || getSampleValue(key);
      
      if (key) {
        extractedVariables.push({ key, value });
      }
    });

    return extractedVariables;
  }, [variables]);

  const handleSave = useCallback(async () => {
    if (!subject.trim()) {
      toast.error("Subject cannot be empty");
      return;
    }

    setIsSaving(true);
    try {
      // Log data for debugging
      console.log('Saving email template with data:', {
        subject,
        html_content: htmlContent,
        variables: variables
      });
      
      // Transform variables array to object for API compatibility
      const transformedVariables = variables.reduce((acc: Record<string, string>, variable: { key: string; value: string }) => {
        if (variable.key) {
          acc[variable.key] = variable.value || "";
        }
        return acc;
      }, {});
      
      console.log('Transformed variables for API:', transformedVariables);

      await updateEmailTemplate.mutateAsync({
        subject,
        html_content: htmlContent,
        variables: transformedVariables
      });
      
      toast.success("Email template updated successfully");
    } catch (error) {
      console.error("Error updating email template:", error);
      toast.error("Failed to update email template");
    } finally {
      setIsSaving(false);
    }
  }, [subject, htmlContent, variables, updateEmailTemplate]);

  const handleCancel = useCallback(() => {
    setSubject(emailTemplate.subject || "");
    setHtmlContent(emailTemplate.html_content || "");
  }, [emailTemplate.subject, emailTemplate.html_content]);

  // Preview with variable substitution
  const previewSubject = substituteVariables(subject, variables);
  const previewContent = getPreviewContent();

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              Editing Email Template
            </Text>
            <Heading level="h2">{emailTemplate.title}</Heading>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              variant="secondary"
              size="small"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleSave}
              disabled={isSaving}
              isLoading={isSaving}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-full w-full flex-col">
          <ProgressTabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col overflow-hidden">
            <ProgressTabs.List className="flex w-full items-center justify-start border-b">
              <ProgressTabs.Trigger value="content">Content</ProgressTabs.Trigger>
              <ProgressTabs.Trigger value="variables">Variables</ProgressTabs.Trigger>
              <ProgressTabs.Trigger value="preview">Preview</ProgressTabs.Trigger>
            </ProgressTabs.List>

            <ProgressTabs.Content value="content" className="flex-1 h-full overflow-y-auto">
              <div className="p-6 space-y-6">
                <div>
                  <Text weight="plus" size="small" className="mb-2">Subject</Text>
                  <Input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Welcome to {{company_name}}!"
                    
                  />
                  <Text className="text-sm text-ui-fg-subtle mt-1">Use {'{{'}variable_name{'}'} for dynamic content</Text>
                </div>

                <div>
                  <Text weight="plus" size="small" className="mb-2">HTML Content</Text>
                  <Textarea
                    value={htmlContent}
                    onChange={(e) => setHtmlContent(e.target.value)}
                    placeholder="<h1>Welcome {{user_name}}!</h1><p>Thank you for joining {{company_name}} ...</p>"
                    rows={12}
                  />
                  <Text className="text-sm text-ui-fg-subtle mt-1">Use {'{{'}variable_name{'}'} for dynamic content</Text>
                </div>
              </div>
            </ProgressTabs.Content>

            <ProgressTabs.Content value="variables" className="flex-1 h-full overflow-y-auto">
              <div className="p-6 h-full flex flex-col">
                <div className="space-y-4 flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between">
                    <Text weight="plus" size="small">Manage Variables</Text>
                    <VariablesModal
                      control={control}
                      predefinedVariables={[]}
                      selectedVariables={variables.map((v: any) => ({ name: v.key, defaultValue: v.value })).filter(v => v.name)}
                      onVariablesChange={(newVariables) => {
                        console.log('VariablesModal onVariablesChange called with:', newVariables);
                        // Clear existing variables
                        remove();
                        
                        // Add new variables with their default values
                        newVariables.forEach(variable => {
                          append({ key: variable.name, value: variable.defaultValue });
                        });
                        console.log('Variables after update:', variables);
                      }}
                      onInsertVariable={() => {
                        // Handle insert if needed
                      }}
                    />
                  </div>
                  
                  <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
                    <div className="space-y-2">
                      {variables.map((variable: any, index: number) => (
                        <div key={variable.id} className="flex items-center justify-between p-2 border rounded">
                          <Text className="font-mono text-sm">{variable.key}</Text>
                          <Button
                            variant="transparent"
                            size="small"
                            onClick={() => remove(index)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </ProgressTabs.Content>

            <ProgressTabs.Content value="preview" className="flex-1 h-full overflow-y-auto">
              <div className="p-6 h-full flex flex-col">
                <div className="border rounded-lg flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="p-4 border-b">
                    <Text weight="plus" size="small">Email Preview</Text>
                  </div>
                  <div className="bg-ui-bg-subtle flex-1 overflow-y-auto min-h-0">
                    <div className="p-4">
                      <div className="mb-3 pb-3 border-b">
                        <Text weight="plus">
                          Subject: {previewSubject}
                        </Text>
                      </div>
                      <div 
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ 
                          __html: previewContent || "<p>No content</p>" 
                        }}
                      />
                    </div>
                  </div>
                </div>

                {getVariablesUsed().length > 0 && (
                  <div className="border rounded-lg p-4 mt-4">
                    <Text weight="plus" size="small" className="mb-2">Variables Used</Text>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {getVariablesUsed().map((variable) => (
                        <div key={variable.key} className="flex items-center text-sm">
                          <span className="font-mono bg-ui-bg-base border rounded px-2 py-1 mr-2">
                            {variable.key}
                          </span>
                          <span className="text-ui-fg-subtle">
                            {variable.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ProgressTabs.Content>
          </ProgressTabs>
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  );
}
