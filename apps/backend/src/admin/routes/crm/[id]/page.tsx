import { ArrowLeft, Spinner } from "@medusajs/icons";
import { Container, Heading, Text, Badge, Button } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { sdk } from "../../../lib/config";

type CrmPerson = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  company_id?: string | null;
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

const CrmPersonDetailPage = () => {
  const { id } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm-person", id],
    queryFn: () =>
      sdk.client.fetch<{ crm_person: CrmPerson }>(`/admin/crm/people/${id}`),
    enabled: !!id,
  });

  const person = data?.crm_person;
  const fullName = person
    ? [person.first_name, person.last_name].filter(Boolean).join(" ")
    : "";

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading>{isLoading ? "Loading…" : fullName || "Person"}</Heading>
          {person?.title && (
            <Text size="small" className="text-ui-fg-subtle">
              {person.title}
            </Text>
          )}
        </div>
        <Link to="/crm">
          <Button variant="secondary" size="small">
            <ArrowLeft />
            Back
          </Button>
        </Link>
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
  );
};

export default CrmPersonDetailPage;
