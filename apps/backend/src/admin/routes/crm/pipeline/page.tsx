import { defineRouteConfig } from "@medusajs/admin-sdk";
import { CurrencyDollar } from "@medusajs/icons";
import {
  Badge,
  Container,
  Heading,
  Select,
  Text,
  toast,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  CRM_OPPORTUNITY_STAGES,
  CRM_STAGE_HINTS,
  CRM_STAGE_LABELS,
  isClosedStage,
  type CrmOpportunityStage,
} from "../../../../modules/crm/stages";
import { sdk } from "../../../lib/config";

/**
 * The deal board. Columns come from the shared stage vocabulary in
 * `modules/crm/stages` — NOT a local copy — so a stage added to the pipeline
 * shows up here without a second edit, and one removed cannot linger as a dead
 * column.
 *
 * The CRM lives on the Autobase node, not Postgres, so there is no query.graph
 * and no join: an opportunity carries `owner_person_id` / `company_id` as ids.
 * Contacts and companies are fetched alongside and resolved client-side, which
 * is one extra request rather than N.
 */

type CrmOpportunity = {
  id: string;
  title: string;
  stage: CrmOpportunityStage;
  amount?: number | null;
  currency?: string | null;
  expected_close_date?: string | null;
  company_id?: string | null;
  owner_person_id?: string | null;
  updated_at?: string;
};

type CrmPerson = { id: string; first_name: string; last_name?: string | null };
type CrmCompany = { id: string; name: string };

const formatAmount = (amount?: number | null, currency?: string | null) => {
  if (amount == null) return null;
  const code = (currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unrecognised currency code must not blank the card.
    return `${code} ${amount.toLocaleString("en-IN")}`;
  }
};

const CrmPipelinePage = () => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["crm-pipeline"],
    queryFn: async () => {
      const [opps, people, companies] = await Promise.all([
        sdk.client.fetch<{ crm_opportunities: CrmOpportunity[] }>(
          "/admin/crm/opportunities",
          { query: { limit: 200 } }
        ),
        sdk.client.fetch<{ crm_people: CrmPerson[] }>("/admin/crm/people", {
          query: { limit: 500 },
        }),
        sdk.client.fetch<{ crm_companies: CrmCompany[] }>(
          "/admin/crm/companies",
          { query: { limit: 200 } }
        ),
      ]);
      return {
        opportunities: opps.crm_opportunities ?? [],
        people: people.crm_people ?? [],
        companies: companies.crm_companies ?? [],
      };
    },
    staleTime: 15_000,
  });

  const moveStage = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: CrmOpportunityStage }) =>
      sdk.client.fetch(`/admin/crm/opportunities/${id}`, {
        method: "POST",
        body: { stage },
      }),
    onSuccess: (_res, vars) => {
      toast.success(`Moved to ${CRM_STAGE_LABELS[vars.stage]}`);
      queryClient.invalidateQueries({ queryKey: ["crm-pipeline"] });
    },
    onError: (e: any) => {
      // The node enforces the stage enum from its own bundled copy of the
      // contract. If it has not been redeployed since the vocabulary changed,
      // the rejection surfaces here and nowhere else — so show what it said
      // rather than a generic failure.
      toast.error(e?.message ?? "Could not move the deal");
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data?.people ?? []) {
      m.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" "));
    }
    return m;
  }, [data?.people]);

  const companyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data?.companies ?? []) m.set(c.id, c.name);
    return m;
  }, [data?.companies]);

  const byStage = useMemo(() => {
    const m = new Map<CrmOpportunityStage, CrmOpportunity[]>();
    for (const stage of CRM_OPPORTUNITY_STAGES) m.set(stage, []);
    for (const o of data?.opportunities ?? []) {
      // An opportunity at a stage this build does not know about (e.g. written
      // before the vocabulary changed) would otherwise vanish from the board
      // entirely. Surface it rather than silently dropping it.
      const bucket = m.get(o.stage) ?? m.get("prospecting")!;
      bucket.push(o);
    }
    return m;
  }, [data?.opportunities]);

  const openTotal = useMemo(() => {
    let sum = 0;
    for (const o of data?.opportunities ?? []) {
      if (!isClosedStage(o.stage) && typeof o.amount === "number") sum += o.amount;
    }
    return sum;
  }, [data?.opportunities]);

  const total = data?.opportunities.length ?? 0;

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col items-start justify-between gap-2 px-6 py-4 md:flex-row md:items-center">
        <div>
          <Heading>CRM · Pipeline</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {isLoading
              ? "Loading deals…"
              : total === 0
                ? "No deals yet. A deal is opened when a lead is genuinely qualified."
                : `${total} deal${total === 1 ? "" : "s"} · ${formatAmount(openTotal, "INR")} open`}
          </Text>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto px-6 py-4">
        {CRM_OPPORTUNITY_STAGES.map((stage) => {
          const deals = byStage.get(stage) ?? [];
          return (
            <div
              key={stage}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-ui-bg-subtle p-3"
            >
              <div className="flex items-center justify-between">
                <Text size="small" weight="plus">
                  {CRM_STAGE_LABELS[stage]}
                </Text>
                <Badge size="2xsmall" color={isClosedStage(stage) ? "grey" : "blue"}>
                  {deals.length}
                </Badge>
              </div>
              <Text size="xsmall" className="text-ui-fg-muted">
                {CRM_STAGE_HINTS[stage]}
              </Text>

              {deals.length === 0 ? (
                <div className="rounded-md border border-dashed border-ui-border-base px-3 py-6 text-center">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Empty
                  </Text>
                </div>
              ) : (
                deals.map((o) => {
                  const owner = o.owner_person_id
                    ? nameById.get(o.owner_person_id)
                    : null;
                  const company = o.company_id
                    ? companyById.get(o.company_id)
                    : null;
                  const amount = formatAmount(o.amount, o.currency);
                  return (
                    <div
                      key={o.id}
                      className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3"
                    >
                      {/* Deliberately not a link: there is no opportunity
                          detail route yet, and a card that navigates to a 404
                          is worse than one that does not navigate. */}
                      <Text size="small" weight="plus">
                        {o.title}
                      </Text>
                      {(owner || company) && (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {[company, owner].filter(Boolean).join(" · ")}
                        </Text>
                      )}
                      {amount && (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {amount}
                        </Text>
                      )}
                      <Select
                        size="small"
                        value={o.stage}
                        onValueChange={(next) =>
                          moveStage.mutate({
                            id: o.id,
                            stage: next as CrmOpportunityStage,
                          })
                        }
                      >
                        <Select.Trigger>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          {CRM_OPPORTUNITY_STAGES.map((s) => (
                            <Select.Item key={s} value={s}>
                              {CRM_STAGE_LABELS[s]}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "CRM Pipeline",
  icon: CurrencyDollar,
});

export default CrmPipelinePage;
