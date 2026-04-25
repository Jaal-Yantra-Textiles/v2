"use client"


import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import { useState } from "react"
import { toast } from "@medusajs/ui"
import { subscribeToNewsletter } from "@lib/data/newsletter"

const NewsletterForm = () => {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (!firstName.trim() || !lastName.trim()) {
        toast.error("Please provide your first and last name to personalize emails.")
        setLoading(false)
        return
      }
      await subscribeToNewsletter(email, {
        domain: "shop.cicilabel.com",
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        subscription_type: "email",
        network: "cicilabel",
      })
    } catch (error) {
      console.error(error)
      // ignore, don't show error to user
    }
    toast.success("Thanks for subscribing!")
    setFirstName("")
    setLastName("")
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
        <blockquote className="mt-2 border-l-2 pl-3 text-ui-fg-subtle italic text-sm">
          We need your first name and last name to personalize the emails being sent.
        </blockquote>
      </div>
      <div className="flex-1 max-w-md w-full">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input
              label="First name"
              name="first_name"
              type="text"
              autoComplete="off"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={loading}
            />
            <Input
              label="Last name"
              name="last_name"
              type="text"
              autoComplete="off"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={loading}
            />
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
          <div className="flex items-end justify-end">
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