import { useState } from "react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import { zodResolver } from "@hookform/resolvers/zod"
import * as zod from "zod"
import {
  Button,
  Text,
  Input,
  Textarea,
  Badge,
  Tabs,
  toast
} from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"

import { AdminPage } from "../../../../../../../hooks/api/pages"
import { Form } from "../../../../../../../components/common/form"
import { KeyboundForm } from "../../../../../../../components/utilitites/key-bound-form"
import { RouteDrawer } from "../../../../../../../components/modal/route-drawer/route-drawer"
import { 
  useSendBlogToSubscribers, 
  useConfirmBlogSubscription,
  SendBlogToSubscribersResponse
} from "../../../../../../../hooks/api/websites"

const sendBlogSchema = zod.object({
  subject: zod.string().min(1, "Subject is required"),
  customMessage: zod.string().optional(),
})

type SendBlogFormData = zod.infer<typeof sendBlogSchema>

// Schema for the test email form
const testEmailSchema = zod.object({
  email: zod.string().email("Valid email address is required"),
  subject: zod.string().min(1, "Subject is required"),
  customMessage: zod.string().optional(),
})

type TestEmailFormData = zod.infer<typeof testEmailSchema>
type TestEmailResult = { success: boolean; error: string | null }

type SendBlogSubscriptionFormProps = {
  pageId: string
  websiteId: string
  page: AdminPage
}

export const SendBlogSubscriptionForm = ({
  pageId,
  websiteId,
  page,
}: SendBlogSubscriptionFormProps) => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<"send" | "test">("send")
  const [confirmationData, setConfirmationData] = useState<SendBlogToSubscribersResponse | null>(null)
  const [subscriberCount, setSubscriberCount] = useState<number>(page.subscriber_count as number || 0)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isSending, setIsSending] = useState(false)
  
  // Test email state
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<TestEmailResult | null>(null)

  // Form for sending to all subscribers
  const form = useForm<SendBlogFormData>({
    defaultValues: {
      subject: `New Blog: ${page.title}`,
      customMessage: "",
    },
    resolver: zodResolver(sendBlogSchema),
  })
  
  // Form for sending test email
  const testForm = useForm<TestEmailFormData>({
    defaultValues: {
      email: "",
      subject: `New Blog: ${page.title}`,
      customMessage: "",
    },
    resolver: zodResolver(testEmailSchema),
  })

  const { 
    mutateAsync: sendBlog
  } = useSendBlogToSubscribers(websiteId, pageId)

  const { 
    mutateAsync: confirmBlog
  } = useConfirmBlogSubscription(
    websiteId, 
    pageId,
    confirmationData?.workflow_id || ""
  )

  const handleSendBlog = async (data: SendBlogFormData) => {
    setIsSending(true)
    try {
      const response = await sendBlog({
        subject: data.subject,
        customMessage: data.customMessage,
      })

      if (response.subscribers) {
        setSubscriberCount(response.subscribers)
      }

      setConfirmationData(response)
    } catch (error) {
      toast.error("Failed to prepare blog for sending", {
        duration: 5000,
      })
    } finally {
      setIsSending(false)
      //   duration: 5000,
      // })
    }
  }

  const handleConfirmSend = async () => {
    setIsConfirming(true)
    try {
      await confirmBlog()
      
      toast.success("Email sent to subscribers successfully!", {
        duration: 5000,
      })
      navigate(`/websites/${websiteId}/pages/${pageId}`)
    } catch (error) {
      toast.error(`Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        duration: 5000,
      })
    } finally {
      setIsConfirming(false)
    }
  }

  const handleCancelConfirmation = () => {
    setConfirmationData(null)
  }

  const handleCancel = () => {
    navigate(`/websites/${websiteId}/pages/${pageId}`)
  }
  
  // Handler for sending test email
  const handleSendTestEmail = async (data: TestEmailFormData) => {
    setIsSendingTest(true)
    setTestResult(null)
    
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
      
      setTestResult({
        success: true,
        error: null,
      })
      
      toast.success('Test email sent successfully!', {
        duration: 5000,
      })
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      
      toast.error(`Failed to send test email: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        duration: 5000,
      })
    } finally {
      setIsSendingTest(false)
    }
  }

  const handleSubmit = form.handleSubmit(handleSendBlog)
  const handleTestSubmit = testForm.handleSubmit(handleSendTestEmail)
  
  return (
    <RouteDrawer.Form form={activeTab === "send" ? form : testForm as any}>
      {!confirmationData ? (
        <KeyboundForm
          onSubmit={activeTab === "send" ? handleSubmit : handleTestSubmit}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "send" | "test")}>
              <Tabs.List className="mb-6">
                <Tabs.Trigger value="send">
                  Send to All Subscribers
                </Tabs.Trigger>
                <Tabs.Trigger value="test">
                  Send Test Email
                </Tabs.Trigger>
              </Tabs.List>
              
              <Tabs.Content value="send" className="flex-1">
                <div className="flex flex-col gap-y-8">
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
              </Tabs.Content>
              <Tabs.Content value="test" className="flex-1">
                <div className="flex flex-col gap-y-8">
                  <Form.Field
                    control={testForm.control}
                    name="email"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Email Address</Form.Label>
                        <Form.Control>
                          <Input 
                            {...field} 
                            placeholder="Enter email address" 
                            type="email"
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  
                  <Form.Field
                    control={testForm.control}
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
                    control={testForm.control}
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
                  
                  {testResult && (
                    <div className="mt-4 p-4 border rounded-lg bg-ui-bg-subtle">
                      <Text weight="plus" className={testResult.success ? "text-ui-fg-success" : "text-ui-fg-error"}>
                        {testResult.success ? "Test email sent successfully!" : "Failed to send test email"}
                      </Text>
                      {testResult.error && (
                        <Text className="text-ui-fg-subtle mt-2">{testResult.error}</Text>
                      )}
                    </div>
                  )}
                </div>
              </Tabs.Content>
            </Tabs>
          </RouteDrawer.Body>
          
          <RouteDrawer.Footer>            
            <Button
              variant="secondary"
              onClick={handleCancel}
              type="button"
              size="small"
            >
              Cancel
            </Button>
            {activeTab === "send" ? (
              <Button 
                type="submit" 
                variant="primary"
                disabled={isSending}
                size="small"
              >
                {isSending ? (
                  <>
                    <Spinner className="animate-spin mr-2" />
                    Preparing...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            ) : (
              <Button 
                type="submit" 
                disabled={isSendingTest}
                size="small"
                variant="primary"
                >
                {isSendingTest ? (
                  <>
                    <Spinner className="animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  "Send Test Email"
                )}
              </Button>
            )}
          </RouteDrawer.Footer>
        </KeyboundForm>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
            <div className="flex flex-col gap-y-4 border rounded-lg p-4">
              <div>
                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                  Subject
                </Text>
                <Text>{form.getValues().subject}</Text>
              </div>

              {form.getValues().customMessage && (
                <div>
                  <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                    Custom Message
                  </Text>
                  <Text>{form.getValues().customMessage}</Text>
                </div>
              )}

              <div>
                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                  Blog Title
                </Text>
                <Text>{page.title}</Text>
              </div>

              <div>
                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                  Subscribers
                </Text>
                <div className="flex items-center gap-x-2">
                  <Text>{subscriberCount}</Text>
                  <Badge>
                    {subscriberCount === 1
                      ? "1 subscriber"
                      : `${subscriberCount} subscribers`}
                  </Badge>
                </div>
              </div>
            </div>
          </RouteDrawer.Body>
          
          <RouteDrawer.Footer>
            <Button
              variant="secondary"
              onClick={handleCancelConfirmation}
              type="button"
              size="small"
            >
              Back
            </Button>
            <Button
              onClick={handleConfirmSend}
              disabled={isConfirming}
              type="button"
              size="small"
            >
              {isConfirming ? (
                <>
                  <Spinner className="animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                "Send to Subscribers"
              )}
            </Button>
          </RouteDrawer.Footer>
        </div>
      )}
    </RouteDrawer.Form>
  )
}
