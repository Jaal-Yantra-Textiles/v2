import { Spinner } from "@medusajs/icons";
import { Container, Heading, Text, Badge } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { UIMatch, useLoaderData, useParams } from "react-router-dom";

import {
  ActivitySection,
  EngagementBadge,
} from "../../../components/crm/activity-timeline";
import { sdk } from "../../../lib/config";
import { crmPersonLoader } from "./loader";

type CrmPerson = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  company_id?: string | null;
  engagement_state?: string | null;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  next_follow_up_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-4 px-6 py-4">
    <Text size="small" leading="compact" weight="plus" className="text-ui-fg-subtle">
      {label}
    </Text>
    <div className="text-right md:text-left">{children}</div>
  </div>
);

const val = (v?: string | null) =>
  v ? (
    <Text size="small">{v}</Text>
  ) : (
    <Text size="small" className="text-ui-fg-muted">
      —
    </Text>
  );

const displayName = (p?: Partial<CrmPerson> | null) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();

const CrmPersonDetailPage = () => {
  const { id } = useParams();

  const initialData = useLoaderData() as
    | Awaited<ReturnType<typeof crmPersonLoader>>
    | undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm-person", id],
    queryFn: () =>
      sdk.client.fetch<{ crm_person: CrmPerson }>(`/admin/crm/people/${id}`),
    enabled: !!id,
    initialData,
  });

  const person = data?.crm_person;

  return (
    // Details and conversation as two stacked records, the way a CRM contact
    // reads: who they are, then what has passed between us.
    <div className="flex flex-col gap-y-2">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col">
            {/* No back button: the breadcrumb below the header is the way out,
                and two competing ways back is how a trail stops being trusted. */}
            <Heading>
              {isLoading ? "Loading…" : displayName(person) || "Person"}
            </Heading>
            {person?.title && (
              <Text size="small" className="text-ui-fg-subtle">
                {person.title}
              </Text>
            )}
          </div>
          {person && (
            <EngagementBadge
              state={person.engagement_state}
              nextFollowUpAt={person.next_follow_up_at}
            />
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center px-6 py-16">
            <Spinner className="text-ui-fg-subtle animate-spin" />
          </div>
        )}

        {isError && (
          <div className="px-6 py-16">
            <Text size="small" className="text-ui-fg-error">
              Could not load this person.
            </Text>
          </div>
        )}

        {person && (
          <div className="divide-y">
            <Row label="First name">{val(person.first_name)}</Row>
            <Row label="Last name">{val(person.last_name)}</Row>
            <Row label="Email">{val(person.email)}</Row>
            <Row label="Phone">{val(person.phone)}</Row>
            <Row label="Title">{val(person.title)}</Row>
            <Row label="Company">
              {person.company_id ? (
                <Badge size="2xsmall">{person.company_id}</Badge>
              ) : (
                val(null)
              )}
            </Row>
            <Row label="ID">
              <Text size="small" className="font-mono text-ui-fg-subtle">
                {person.id}
              </Text>
            </Row>
            <Row label="Last reply from them">
              {val(
                person.last_inbound_at
                  ? new Date(person.last_inbound_at).toLocaleString()
                  : null
              )}
            </Row>
            <Row label="Last time we reached out">
              {val(
                person.last_outbound_at
                  ? new Date(person.last_outbound_at).toLocaleString()
                  : null
              )}
            </Row>
            <Row label="Created">
              {val(
                person.created_at
                  ? new Date(person.created_at).toLocaleString()
                  : null
              )}
            </Row>
          </div>
        )}
      </Container>

      {person && <ActivitySection relatedType="person" relatedId={person.id} />}
    </div>
  );
};

export default CrmPersonDetailPage;

export async function loader({ params }: any) {
  return crmPersonLoader({ params });
}

export const handle = {
  // `match.data` is the loader's payload. Falling back to the id keeps the
  // crumb honest when the load failed rather than printing "Contact" over a
  // record that is not there.
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const data = match.data as { crm_person?: Partial<CrmPerson> } | undefined;
    return displayName(data?.crm_person) || match.params.id;
  },
};
