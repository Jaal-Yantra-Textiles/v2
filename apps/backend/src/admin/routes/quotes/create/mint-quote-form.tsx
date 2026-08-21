import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useMemo, useState } from "react"

import { usePartners } from "../../../hooks/api/partners"
import { useProducts } from "../../../hooks/api/products"
import { useMintQuote } from "../../../hooks/api/quotes"
import { MintedPanel } from "./minted-panel"

type Line = { variant_id: string; quantity: number }

/**
 * Mint a quote on a partner's behalf (#1419).
 *
 * The partner comes first and everything else follows from it: a quote is
 * priced against THAT partner's catalogue and shipped from THEIR location. The
 * backend refuses variants outside the chosen partner's sales channel, so this
 * form's job is to make that mistake hard rather than to re-implement the check.
 */
export const MintQuoteForm = () => {
  const [partnerId, setPartnerId] = useState("")
  const [buyerEmail, setBuyerEmail] = useState("")
  const [company, setCompany] = useState("")
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [country, setCountry] = useState("in")
  const [postal, setPostal] = useState("")
  const [currency, setCurrency] = useState("inr")
  const [ttlDays, setTtlDays] = useState("14")
  const [lines, setLines] = useState<Line[]>([])
  const [minted, setMinted] = useState<{ token: string; quote: any } | null>(null)

  const { partners } = usePartners({ limit: 200 } as any)
  const { products } = useProducts({ limit: 100 } as any)

  const variantOptions = useMemo(() => {
    const out: Array<{ id: string; label: string }> = []
    for (const p of (products ?? []) as any[]) {
      for (const v of p.variants ?? []) {
        out.push({ id: v.id, label: `${p.title} — ${v.title}` })
      }
    }
    return out
  }, [products])

  const { mutate: mint, isPending } = useMintQuote({
    onSuccess: (data) => setMinted({ token: data.token, quote: data.quote }),
    onError: (e: any) =>
      toast.error(e?.message ?? "Could not mint the quote."),
  })

  // The panel REPLACES the form rather than sitting beside it. The token is
  // shown once and never again, so anything that invites navigating away
  // before copying it is a way to lose a quote.
  if (minted) {
    return <MintedPanel token={minted.token} quote={minted.quote} />
  }

  const addLine = () =>
    setLines((prev) => [...prev, { variant_id: "", quantity: 1 }])

  const canSubmit =
    !!partnerId &&
    !!buyerEmail &&
    !!currency &&
    lines.length > 0 &&
    lines.every((l) => l.variant_id && l.quantity > 0)

  const submit = () => {
    mint({
      partner_id: partnerId,
      buyer_email: buyerEmail,
      recipient_company: company || null,
      recipient_name: name || null,
      partner_note: note || null,
      lines,
      destination_country_code: country,
      destination_postal_code: postal || null,
      currency_code: currency,
      ttl_days: Number(ttlDays) || undefined,
    })
  }

  return (
    <div className="flex flex-col gap-y-6 px-6 py-6">
      <div>
        <Heading>Mint a quote</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          The buyer link is shown once and cannot be recovered — you will be
          asked to copy it before leaving this page.
        </Text>
      </div>

      <div className="flex flex-col gap-y-2">
        <Label>Partner</Label>
        <Select value={partnerId} onValueChange={setPartnerId}>
          <Select.Trigger>
            <Select.Value placeholder="Select a partner" />
          </Select.Trigger>
          <Select.Content>
            {((partners ?? []) as any[]).map((p) => (
              <Select.Item key={p.id} value={p.id}>
                {p.name || p.id}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Text size="xsmall" className="text-ui-fg-subtle">
          Prices come from this partner's catalogue and freight from their
          location. Variants outside their store are rejected.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-y-2">
          <Label>Buyer email</Label>
          <Input
            type="email"
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            placeholder="procurement@example.com"
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label>Company</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label>Contact name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label>Currency</Label>
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toLowerCase())}
            placeholder="inr"
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label>Destination country (ISO-2)</Label>
          <Input
            value={country}
            onChange={(e) => setCountry(e.target.value.toLowerCase())}
            placeholder="in"
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label>Destination postcode</Label>
          <Input value={postal} onChange={(e) => setPostal(e.target.value)} />
        </div>
        <div className="flex flex-col gap-y-2">
          <Label>Valid for (days)</Label>
          <Input
            type="number"
            value={ttlDays}
            onChange={(e) => setTtlDays(e.target.value)}
          />
          <Text size="xsmall" className="text-ui-fg-subtle">
            Drives the price list's end date, so expiry is enforced by pricing
            itself rather than by a sweep.
          </Text>
        </div>
      </div>

      <div className="flex flex-col gap-y-3">
        <div className="flex items-center justify-between">
          <Label>Lines</Label>
          <Button variant="secondary" size="small" onClick={addLine}>
            Add line
          </Button>
        </div>
        {lines.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            A quote is a basket — add at least one line. Multiple lines are
            quoted as ONE consignment, so freight is charged once.
          </Text>
        ) : null}
        {lines.map((line, i) => (
          <div key={i} className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-y-2">
              <Select
                value={line.variant_id}
                onValueChange={(v) =>
                  setLines((prev) =>
                    prev.map((l, idx) => (idx === i ? { ...l, variant_id: v } : l))
                  )
                }
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select a variant" />
                </Select.Trigger>
                <Select.Content>
                  {variantOptions.map((v) => (
                    <Select.Item key={v.id} value={v.id}>
                      {v.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div className="w-28">
              <Input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, idx) =>
                      idx === i ? { ...l, quantity: Number(e.target.value) } : l
                    )
                  )
                }
              />
            </div>
            <Button
              variant="transparent"
              size="small"
              onClick={() =>
                setLines((prev) => prev.filter((_, idx) => idx !== i))
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-y-2">
        <Label>Note to the buyer</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!canSubmit || isPending}>
          {isPending ? "Minting…" : "Mint quote"}
        </Button>
      </div>
    </div>
  )
}
