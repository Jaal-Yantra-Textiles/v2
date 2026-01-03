"use client"

import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import { toast } from "@medusajs/ui"
import { useState } from "react"
import { submitWebsiteFormResponse } from "@lib/data/forms"

const ContactUsForm = () => {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [company, setCompany] = useState("")
  const [role, setRole] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (!name.trim() || !email.trim() || !message.trim()) {
        toast.error("Name, Email, and Message are required.")
        setLoading(false)
        return
      }

      await submitWebsiteFormResponse(
        {
          email: email.trim(),
          data: {
            name: name.trim(),
            company: company.trim() || "",
            role: role.trim() || "",
            message: message.trim(),
          },
          metadata: {
            source: "storefront-contact-us",
          },
        },
        {
          // defaults can be overridden via env vars
        }
      )

      toast.success("Thank you for your message! We will get back to you soon.")
      setName("")
      setEmail("")
      setCompany("")
      setRole("")
      setMessage("")
    } catch (error) {
      console.error(error)
      toast.error("Unable to submit the form right now. Please try again later.")
    }

    setLoading(false)
  }

  return (
    <div className="flex flex-col lg:flex-row items-start justify-between gap-8">
      <div className="flex-1 max-w-md">
        <h3 className="txt-compact-large-plus mb-2 text-ui-fg-base">Contact us</h3>
        <p className="text-base-regular text-ui-fg-subtle">
          Send us a message and we will get back to you.
        </p>
      </div>

      <div className="flex-1 max-w-md w-full">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              label="Name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            <Input
              label="Company"
              name="company"
              type="text"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={loading}
            />
            <Input
              label="Role"
              name="role"
              type="text"
              autoComplete="organization-title"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col w-full">
            <div className="flex relative z-0 w-full txt-compact-medium">
              <textarea
                name="message"
                placeholder=" "
                required
                className="pt-4 pb-1 block w-full min-h-28 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={loading}
              />
              <label
                htmlFor="message"
                className="flex items-center justify-center mx-3 px-1 transition-all absolute duration-300 top-3 -z-1 origin-0 text-ui-fg-subtle"
              >
                Message<span className="text-rose-500">*</span>
              </label>
            </div>
          </div>

          <div className="flex items-end justify-end">
            <SubmitButton data-testid="contact-us-submit-button">
              Send
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ContactUsForm
