import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as zod from "@medusajs/framework/zod"
import {
  Button,
  Text,
  Input,
  Textarea,
  toast,
} from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"

import { AdminPage } from "../../../../../../../hooks/api/pages"
import { Form } from "../../../../../../../components/common/form"
import { KeyboundForm } from "../../../../../../../components/utilitites/key-bound-form"
import { RouteDrawer } from "../../../../../../../components/modal/route-drawer/route-drawer"

// Define the schema for the test email form
const testEmailSchema = zod.object({
  email: zod.string().email("Valid email address is required"),
  subject: zod.string().min(1, "Subject is required"),
  customMessage: zod.string().optional(),
})

type TestEmailFormData = zod.infer<typeof testEmailSchema>
type TestEmailResult = { success: boolean; error: string | null }

type SendTestBlogEmailFormProps = {
  pageId: string
  websiteId: string
  page: AdminPage
}

export const SendTestBlogEmailForm = ({
  pageId,
  websiteId,
  page,
}: SendTestBlogEmailFormProps) => {
  const [isSending, setIsSending] = useState(false)
  const [result, setResult] = useState<TestEmailResult | null>(null)

  const form = useForm<TestEmailFormData>({
    defaultValues: {
      email: "",
      subject: `New Blog: ${page.title}`,
      customMessage: "",
    },
    resolver: zodResolver(testEmailSchema),
  })

  const handleSendTestEmail = async (data: TestEmailFormData) => {
    setIsSending(true)
    setResult(null)
    
    try {
      const response = await fetch(`/admin/websites/${websiteId}/pages/${pageId}/subs/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: data.email,
          subject: data.subject,
          customMessage: data.customMessage,
        }),
      })

      const responseData = await response.json()
      
      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to send test email')
      }
      
      setResult({
        success: true,
        error: null,
      })
      
      toast.success('Test email sent successfully!', {
        duration: 5000,
      })
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      
      toast.error(`Failed to send test email: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        duration: 5000,
      })
    } finally {
      setIsSending(false)
    }
  }
  
  const handleSubmit = form.handleSubmit(handleSendTestEmail)
  
  return (
    <RouteDrawer.Form form={form}>
    <KeyboundForm
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <RouteDrawer.Body className="p-4">
      <div className="flex flex-col gap-y-8">
        <Form.Field
          control={form.control}
          name="email"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Email Address</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  placeholder="Enter email address for test" 
                />
              </Form.Control>
              <Form.Hint>
                The test email will be sent to this address only.
              </Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="subject"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Email Subject</Form.Label>
              <Form.Control>
                <Input 
                  {...field} 
                  placeholder="Enter email subject" 
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="customMessage"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Custom Message</Form.Label>
              <Form.Control>
                <Textarea
                  {...field}
                  placeholder="Add a custom message to include in the email (optional)"
                  rows={4}
                />
              </Form.Control>
              <Form.Hint>
                This message will appear at the top of the email, before the blog content.
              </Form.Hint>
            </Form.Item>
          )}
        />
      </div>
      </RouteDrawer.Body>
      
      {result && (
        <div className="mt-6 mb-4 p-4 border rounded-lg bg-ui-bg-subtle">
          <Text weight="plus" className="mb-2">Test Email Result</Text>
          <Text className={result.success ? "text-ui-fg-success" : "text-ui-fg-error"}>
            {result.success ? "Email sent successfully" : `Failed: ${result.error}`}
          </Text>
        </div>
      )}
      
      <RouteDrawer.Footer>
      <div className="flex items-center justify-end gap-x-2">
        <Button 
          type="submit" 
          disabled={isSending}
        >
          {isSending ? (
            <>
              <Spinner className="animate-spin mr-2" />
              Sending Test Email...
            </>
          ) : (
            "Send Test Email"
          )}
        </Button>
      </div>
      </RouteDrawer.Footer>
      
    </KeyboundForm>
    </RouteDrawer.Form>
  )
}
