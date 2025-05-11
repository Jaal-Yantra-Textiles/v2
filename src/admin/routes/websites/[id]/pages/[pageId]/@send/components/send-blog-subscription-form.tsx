import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import { zodResolver } from "@hookform/resolvers/zod"
import * as zod from "zod"
import {
  Button,
  Text,
  Input,
  Textarea,
  Badge,
  toast,
} from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"

import { 
  useSendBlogToSubscribers, 
  useConfirmBlogSubscription,
  SendBlogToSubscribersResponse
} from "../../../../../../../hooks/api/websites"
import { AdminPage } from "../../../../../../../hooks/api/pages"
import { Form } from "../../../../../../../components/common/form"
import { RouteDrawer } from "../../../../../../../components/modal/route-drawer/route-drawer"
import { KeyboundForm } from "../../../../../../../components/utilitites/key-bound-form"
import { useRouteModal } from "../../../../../../../components/modal/use-route-modal"

const sendBlogSchema = zod.object({
  subject: zod.string().min(1, "Subject is required"),
  customMessage: zod.string().optional(),
})

type SendBlogFormData = zod.infer<typeof sendBlogSchema>

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
  const { handleSuccess } = useRouteModal()
  const [confirmationData, setConfirmationData] = useState<SendBlogToSubscribersResponse | null>(null)
  const [subscriberCount, setSubscriberCount] = useState<number>(page.subscriber_count as number || 0)

  const form = useForm<SendBlogFormData>({
    defaultValues: {
      subject: `New Blog: ${page.title}`,
      customMessage: "",
    },
    resolver: zodResolver(sendBlogSchema),
  })

  const { 
    mutateAsync: sendBlog, 
    isPending: isSending 
  } = useSendBlogToSubscribers(websiteId, pageId)

  const { 
    mutateAsync: confirmSend, 
    isPending: isConfirming 
  } = useConfirmBlogSubscription(
    websiteId, 
    pageId, 
    confirmationData?.workflow_id || ""
  )

  const handleSendBlog = async (data: SendBlogFormData) => {
    try {
      const response = await sendBlog({
        subject: data.subject,
        customMessage: data.customMessage,
      })

      // Update subscriber count from API response if available
      if (response.subscribers) {
        setSubscriberCount(response.subscribers)
      }

      setConfirmationData(response)
    } catch (error) {
      toast.error("Failed to prepare blog for sending", {
        duration: 5000,
      })
    }
  }

  const handleConfirmSend = async () => {
    if (!confirmationData) {
      return
    }

    try {
      await confirmSend()

      toast.success("Blog post sent to subscribers successfully", {
        duration: 5000,
      })

      // Use handleSuccess from RouteModal to close the drawer and return to the page
      handleSuccess()
    } catch (error) {
      toast.error("Failed to send blog to subscribers", {
        duration: 5000,
      })
    }
  }

  const handleCancelConfirmation = () => {
    setConfirmationData(null)
  }

  const handleCancel = () => {
    navigate(`/websites/${websiteId}/pages/${pageId}`)
  }

  const handleSubmit = form.handleSubmit(handleSendBlog)
  
  return (
    <RouteDrawer.Form form={form}>
      {!confirmationData ? (
        <KeyboundForm
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
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
          </RouteDrawer.Body>
          
          <RouteDrawer.Footer>            
            <Button
              variant="secondary"
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSending}
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
            >
              Back
            </Button>
            <Button
              onClick={handleConfirmSend}
              disabled={isConfirming}
              type="button"
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
