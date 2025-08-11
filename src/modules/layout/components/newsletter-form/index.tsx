"use client"


import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import { useState } from "react"
import { toast } from "@medusajs/ui"
import { subscribeToNewsletter } from "@lib/data/newsletter"

const NewsletterForm = () => {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    try {
      await subscribeToNewsletter(email)
    } catch (error) {
      console.error(error)
      // ignore, don't show error to user
    }
    toast.success("Thanks for subscribing!")
    setEmail("")
    setLoading(false)
  }

  return (
    <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
      <div className="flex-1 max-w-md">
        <h3 className="txt-compact-large-plus mb-2 text-ui-fg-base">Subscribe to our newsletter</h3>
        <p className="text-base-regular text-ui-fg-subtle">
          Receive updates on our latest products and exclusive offers.
        </p>
      </div>
      <div className="flex-1 max-w-md w-full">
        <form onSubmit={handleSubmit} className="flex gap-x-2">
          <div className="flex-1">
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="off"
              required
              data-testid="newsletter-email-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="flex items-end">
            <SubmitButton data-testid="newsletter-submit-button">
              Subscribe
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NewsletterForm