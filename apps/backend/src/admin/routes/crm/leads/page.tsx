import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Envelope } from "@medusajs/icons";
import {
  Badge,
  Button,
  Container,
  Heading,
  Select,
  Text,
  toast,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { sdk } from "../../../lib/config";

/**
 * The intake queue: ad-leads that have not yet become CRM contacts.
 *
 * This is the screen the whole lead->CRM bridge exists for. 230 leads had sat
 * at status `new` since November with no surface that made "work this one" a
 * single action.
 *
 * Deliberately NOT a full lead browser — `/admin/meta-ads/leads` already lists
 * and filters every lead in detail. This shows the unworked ones and the one
 * button that moves them forward.
 */

type Lead = {
  id: string;
  email?: string | null;
  phone?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  source_platform?: string | null;
  campaign_name?: string | null;
  created_time?: string | null;
  external_id?: string | null;
  external_system?: string | null;
};

type LeadsResponse = { leads: Lead[]; total: number };

/**
 * Prod stores three spellings for two platforms (`fb`, `facebook`, `ig`).
 * Mirrors `normalizeLeadSource` in modules/crm/lead-to-crm — kept in sync by
 * eye rather than by import, because that module pulls server-only types.
 */
const SOURCE_LABELS: Record<string, string> = {
  fb: "Facebook",
  facebook: "Facebook",
  ig: "Instagram",
  instagram: "Instagram",
  email: "Email",
  extension: "Web capture",
};

const sourceLabel = (raw?: string | null) =>
  SOURCE_LABELS[(raw ?? "").toLowerCase()] ?? raw ?? "Unknown";

const displayName = (l: Lead) =>
  [l.first_name, l.last_name].filter(Boolean).join(" ") ||
  l.full_name ||
  l.email ||
  l.id;

const formatDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
};

/** One page of the intake queue. Named so the count can say when it is capped. */
const LEAD_PAGE_SIZE = 100;

const CrmLeadsPage = () => {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("new");

  const { data, isLoading } = useQuery({
    queryKey: ["crm-intake", status],
    queryFn: () =>
      sdk.client.fetch<LeadsResponse>("/admin/meta-ads/leads", {
        query: { limit: LEAD_PAGE_SIZE, ...(status === "all" ? {} : { status }) },
      }),
    staleTime: 15_000,
  });

  const importLead = useMutation({
    mutationFn: (leadId: string) =>
      sdk.client.fetch<{ action: string; crm_person_id: string }>(
        `/admin/crm/leads/${leadId}/import`,
        { method: "POST" }
      ),
    onSuccess: (res) => {
      toast.success(
        res.action === "linked"
          ? "Linked to the contact already in the CRM"
          : res.action === "already_imported"
            ? "Already in the CRM"
            : "Added to the CRM"
      );
      queryClient.invalidateQueries({ queryKey: ["crm-intake"] });
      queryClient.invalidateQueries({ queryKey: ["crm-people"] });
    },
    onError: (e: any) => {
      // A lead with no email genuinely cannot be imported — the CRM keys
      // contacts on it. The route says which, so show that rather than a
      // generic failure the user cannot act on.
      toast.error(e?.message ?? "Could not import this lead");
    },
  });

  const leads = data?.leads ?? [];

  const unimported = useMemo(
    () => leads.filter((l) => !(l.external_system === "crm" && l.external_id)),
    [leads]
  );

  /**
   * 🔴 `unimported.length` counts THIS PAGE, not the queue.
   *
   * The query asks for 100 and the docblock above records 230 leads sitting at
   * `new`. Printing the filtered page count as though it were the backlog says
   * "100 leads not yet in the CRM" beside "230 total" — a number that stops
   * growing at 100 and quietly understates the work left, which is the opposite
   * of what an intake queue is for.
   *
   * Said as "at least" when the page is full, because that is the honest claim:
   * we know of this many and cannot see past the page.
   */
  const pageIsFull = leads.length >= LEAD_PAGE_SIZE;

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col items-start justify-between gap-2 px-6 py-4 md:flex-row md:items-center">
        <div>
          <Heading>CRM · Intake</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {isLoading
              ? "Loading leads…"
              : `${pageIsFull ? "at least " : ""}${unimported.length} lead${
                  unimported.length === 1 ? "" : "s"
                } not yet in the CRM${data?.total ? ` · ${data.total} total` : ""}`}
          </Text>
        </div>
        <Select size="small" value={status} onValueChange={setStatus}>
          <Select.Trigger className="w-48">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="new">New (unworked)</Select.Item>
            <Select.Item value="contacted">Contacted</Select.Item>
            <Select.Item value="qualified">Qualified</Select.Item>
            <Select.Item value="all">All statuses</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {!isLoading && leads.length === 0 && (
        <div className="px-6 py-10 text-center">
          <Text size="small" className="text-ui-fg-muted">
            No leads with this status.
          </Text>
        </div>
      )}

      <div className="divide-y">
        {leads.map((lead) => {
          const imported = lead.external_system === "crm" && !!lead.external_id;
          return (
            <div
              key={lead.id}
              className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Text size="small" weight="plus">
                    {displayName(lead)}
                  </Text>
                  <Badge size="2xsmall">{sourceLabel(lead.source_platform)}</Badge>
                  {lead.status && (
                    <Badge
                      size="2xsmall"
                      color={lead.status === "new" ? "orange" : "grey"}
                    >
                      {lead.status}
                    </Badge>
                  )}
                  {imported && (
                    <Badge size="2xsmall" color="green">
                      in CRM
                    </Badge>
                  )}
                </div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {[lead.email, lead.phone].filter(Boolean).join(" · ") || "—"}
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted truncate">
                  {formatDate(lead.created_time)}
                  {lead.campaign_name ? ` · ${lead.campaign_name}` : ""}
                </Text>
              </div>

              <Button
                size="small"
                variant={imported ? "secondary" : "primary"}
                disabled={imported || importLead.isPending}
                onClick={() => importLead.mutate(lead.id)}
              >
                {imported ? "In CRM" : "Add to CRM"}
              </Button>
            </div>
          );
        })}
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "CRM Intake",
  icon: Envelope,
});

export default CrmLeadsPage;

export const handle = {
  breadcrumb: () => "Intake",
};
