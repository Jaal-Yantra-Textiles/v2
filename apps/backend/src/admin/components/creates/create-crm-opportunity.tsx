import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { sdk } from "../../lib/config";
import { fetchAllCrm } from "../../lib/crm-list";
import { Combobox } from "../inputs/combobox/combobox";
import {
  CRM_OPPORTUNITY_DEFAULT_STAGE,
  CRM_OPPORTUNITY_STAGES,
  CRM_STAGE_LABELS,
} from "../../../modules/crm/stages";

/**
 * Opening a deal (#1552).
 *
 * 🔴 Before this there was NO action anywhere in the product that could put a
 * row on the pipeline board. `POST /admin/crm/opportunities` had no caller,
 * `createOpportunityWorkflow` had zero callers anywhere in `src/`, and the only
 * opportunities that could exist were ones somebody created by hand with curl.
 * The board rendered six labelled, drop-target columns over a collection
 * nothing could populate — which reads as a data-loading failure, not as "you
 * have not opened a deal yet".
 *
 * `owner_person_id` and `company_id` prefill from the query string, because the
 * thought "this is a real deal" occurs while looking at a CONTACT, not at a
 * board.
 */

// Mirrors CreateCrmOpportunitySchema. `amount` is typed as text and coerced —
// an empty numeric input yields NaN, which would fail `.nonnegative()` with a
// message about a number the user never entered.
const opportunitySchema = z.object({
  title: z.string().min(1, "A title is required"),
  stage: z.enum(CRM_OPPORTUNITY_STAGES),
  amount: z.string(),
  currency: z.string(),
  expected_close_date: z.string(),
  company_id: z.string(),
  owner_person_id: z.string(),
})

type OpportunityFormData = z.infer<typeof opportunitySchema>

type CrmOpportunity = { id: string; title: string }
type CrmPerson = { id: string; first_name: string; last_name?: string | null }
type CrmCompany = { id: string; name: string }

export const CreateCrmOpportunityComponent = () => {
  const [params] = useSearchParams()

  const form = useForm<OpportunityFormData>({
    defaultValues: {
      title: "",
      stage: CRM_OPPORTUNITY_DEFAULT_STAGE,
      amount: "",
      currency: "INR",
      expected_close_date: "",
      company_id: params.get("company_id") || "",
      owner_person_id: params.get("owner_person_id") || "",
    },
    resolver: zodResolver(opportunitySchema),
  })

  const { handleSuccess } = useRouteModal()
  const queryClient = useQueryClient()

  /**
   * Contacts and companies as pickers rather than raw id fields. An id typed by
   * hand is how a deal ends up owned by nobody — the board resolves these ids
   * to names, and an unresolvable one renders as the ULID itself.
   *
   * PAGED, not `limit: 500`. The route clamps limit to 100 without complaining,
   * so this dropdown used to hold the first 100 of 234 contacts: the other 134
   * could not be picked at all, and arriving here from one of them prefilled an
   * id with no matching option, which renders as the "Nobody yet" placeholder —
   * indistinguishable from having chosen nobody.
   */
  const { data: refs } = useQuery({
    queryKey: ["crm-opportunity-refs"],
    queryFn: async () => {
      const [people, companies] = await Promise.all([
        fetchAllCrm<CrmPerson>("/admin/crm/people", "crm_people"),
        fetchAllCrm<CrmCompany>("/admin/crm/companies", "crm_companies"),
      ])
      return { people: people.rows, companies: companies.rows }
    },
    staleTime: 60_000,
  })

  const personOptions = useMemo(
    () =>
      (refs?.people ?? []).map((p) => ({
        label:
          [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.id,
        value: p.id,
      })),
    [refs?.people]
  )

  const companyOptions = useMemo(
    () =>
      (refs?.companies ?? []).map((c) => ({
        label: c.name || c.id,
        value: c.id,
      })),
    [refs?.companies]
  )

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ crm_opportunity: CrmOpportunity }>(
        "/admin/crm/opportunities",
        { method: "POST", body }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-pipeline"] })
      queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] })
    },
  })

  const handleSubmit = form.handleSubmit(async (data) => {
    const amount = data.amount.trim()
    const parsedAmount = amount === "" ? undefined : Number(amount)

    if (parsedAmount !== undefined && !Number.isFinite(parsedAmount)) {
      form.setError("amount", { message: "Enter a number, or leave it blank" })
      return
    }

    const body = {
      title: data.title.trim(),
      stage: data.stage,
      amount: parsedAmount,
      currency: data.currency.trim() || "INR",
      /**
       * The API takes an ISO datetime; the date input gives `YYYY-MM-DD`.
       * Sending the bare date is a 400 that reads as "invalid datetime" with no
       * hint that the field the user filled in is the one at fault.
       */
      expected_close_date: data.expected_close_date
        ? new Date(`${data.expected_close_date}T00:00:00.000Z`).toISOString()
        : undefined,
      company_id: data.company_id.trim() || undefined,
      owner_person_id: data.owner_person_id.trim() || undefined,
    }

    await mutateAsync(body, {
      onSuccess: ({ crm_opportunity }) => {
        toast.success(`Deal opened: ${crm_opportunity.title}`)
        handleSuccess("/crm/pipeline")
      },
      onError: (error) => {
        /**
         * The standalone node re-validates the stage against its OWN bundled
         * copy of the contract. If it has not been redeployed since the
         * vocabulary changed, the refusal surfaces only here — so show what it
         * said rather than a generic failure.
         */
        toast.error((error as Error).message)
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              Open deal
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Open a deal</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                A deal on the pipeline board — what is being sold, to whom, and
                what it is worth.
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="title"
                render={({ field }) => (
                  <Form.Item className="md:col-span-2">
                    <Form.Label>Title</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="stage"
                render={({ field: { onChange, ...field } }) => (
                  <Form.Item>
                    <Form.Label>Stage</Form.Label>
                    <Form.Control>
                      <Select {...field} onValueChange={onChange}>
                        <Select.Trigger>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          {CRM_OPPORTUNITY_STAGES.map((stage) => (
                            <Select.Item key={stage} value={stage}>
                              {CRM_STAGE_LABELS[stage]}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="expected_close_date"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Expected close</Form.Label>
                    <Form.Control>
                      <Input type="date" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Amount</Form.Label>
                    <Form.Control>
                      <Input inputMode="decimal" autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Currency</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              {/* Searchable: 234 contacts is past the point where a plain
                  dropdown is usable, and the name is what the user knows. */}
              <Form.Field
                control={form.control}
                name="owner_person_id"
                render={({ field: { onChange, value, ref: _ref, ...field } }) => (
                  <Form.Item>
                    <Form.Label optional>Contact</Form.Label>
                    <Form.Control>
                      {/* The wrapper carries the test hook: when a value is
                          selected the Combobox hides its input and renders the
                          chosen label in a SIBLING element, so anchoring a test
                          on the input alone cannot see what is selected. */}
                      <div data-testid="crm-opportunity-contact">
                        <Combobox
                          {...field}
                          options={personOptions}
                          value={value}
                          onChange={(next) => onChange((next as string) || "")}
                          allowClear
                          placeholder="Search contacts"
                        />
                      </div>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="company_id"
                render={({ field: { onChange, value, ref: _ref, ...field } }) => (
                  <Form.Item>
                    <Form.Label optional>Company</Form.Label>
                    <Form.Control>
                      <div data-testid="crm-opportunity-company">
                        <Combobox
                          {...field}
                          options={companyOptions}
                          value={value}
                          onChange={(next) => onChange((next as string) || "")}
                          allowClear
                          placeholder="Search companies"
                        />
                      </div>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
