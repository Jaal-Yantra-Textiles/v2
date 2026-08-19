import {
  Badge,
  Button,
  Heading,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  CRM_ACTIVITY_CHANNELS,
  CRM_ENGAGEMENT_HINTS,
  CRM_ENGAGEMENT_LABELS,
  type CrmActivityChannel,
  type CrmActivityDirection,
  type CrmEngagementState,
} from "../../../modules/crm/activity";
import { sdk } from "../../lib/config";

/**
 * The interaction timeline for one CRM record, plus the one-box logger.
 *
 * Logging is deliberately three fields — direction, channel, what happened —
 * because an activity form that asks for ten is a form nobody fills in, and an
 * unlogged conversation is worse than a roughly-logged one. Everything else
 * (summary, occurred_at, engagement recompute) is derived server-side.
 */

type CrmActivity = {
  id: string;
  related_type: string;
  related_id: string;
  activity_type: string;
  kind?: string | null;
  direction: CrmActivityDirection;
  channel?: CrmActivityChannel | null;
  subject?: string | null;
  body?: string | null;
  summary?: string | null;
  occurred_at: string;
  outcome?: string | null;
};

const DIRECTION_LABELS: Record<CrmActivityDirection, string> = {
  inbound: "They contacted us",
  outbound: "We contacted them",
  internal: "Internal note",
};

const directionColor = (d: string) =>
  d === "inbound" ? "green" : d === "outbound" ? "blue" : "grey";

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const EngagementBadge = ({
  state,
  nextFollowUpAt,
}: {
  state?: string | null;
  nextFollowUpAt?: string | null;
}) => {
  const s = (state ?? "not_contacted") as CrmEngagementState;
  const label = CRM_ENGAGEMENT_LABELS[s] ?? s;
  const color =
    s === "in_conversation"
      ? "green"
      : s === "follow_up_due"
        ? "orange"
        : s === "stalled" || s === "do_not_contact"
          ? "red"
          : "grey";
  return (
    <div className="flex flex-col items-end gap-1 md:items-start">
      <Badge size="2xsmall" color={color as any}>
        {label}
      </Badge>
      <Text size="xsmall" className="text-ui-fg-muted">
        {CRM_ENGAGEMENT_HINTS[s] ?? ""}
        {nextFollowUpAt ? ` · due ${formatWhen(nextFollowUpAt)}` : ""}
      </Text>
    </div>
  );
};

export const ActivityTimeline = ({
  relatedType,
  relatedId,
}: {
  relatedType: "person" | "company" | "opportunity";
  relatedId: string;
}) => {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<CrmActivityDirection>("outbound");
  const [channel, setChannel] = useState<CrmActivityChannel>("whatsapp");
  const [body, setBody] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["crm-activities", relatedType, relatedId],
    queryFn: () =>
      sdk.client.fetch<{ crm_activities: CrmActivity[] }>(
        "/admin/crm/activities",
        {
          query: { related_type: relatedType, related_id: relatedId, limit: 100 },
        }
      ),
    enabled: !!relatedId,
  });

  const log = useMutation({
    mutationFn: () =>
      sdk.client.fetch("/admin/crm/activities", {
        method: "POST",
        body: {
          related_type: relatedType,
          related_id: relatedId,
          // An internal entry is a note; anything that reached them is a message
          // unless the user says otherwise. Keeping this mapping here rather
          // than asking is what keeps the form to three fields.
          activity_type: direction === "internal" ? "note" : "message",
          direction,
          ...(direction === "internal" ? {} : { channel }),
          body: body.trim(),
        },
      }),
    onSuccess: () => {
      setBody("");
      toast.success("Logged");
      queryClient.invalidateQueries({ queryKey: ["crm-activities"] });
      // The engagement state is recomputed server-side on every log, so the
      // contact header is stale the moment this succeeds.
      queryClient.invalidateQueries({ queryKey: ["crm-person"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not log that"),
  });

  const activities = data?.crm_activities ?? [];

  return (
    <div className="divide-y">
      <div className="flex flex-col gap-2 px-6 py-4">
        <Heading level="h3">Activity</Heading>

        <div className="flex flex-col gap-2 md:flex-row">
          <Select
            size="small"
            value={direction}
            onValueChange={(v) => setDirection(v as CrmActivityDirection)}
          >
            <Select.Trigger className="md:w-56">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {(
                ["outbound", "inbound", "internal"] as CrmActivityDirection[]
              ).map((d) => (
                <Select.Item key={d} value={d}>
                  {DIRECTION_LABELS[d]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>

          {direction !== "internal" && (
            <Select
              size="small"
              value={channel}
              onValueChange={(v) => setChannel(v as CrmActivityChannel)}
            >
              <Select.Trigger className="md:w-40">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {CRM_ACTIVITY_CHANNELS.map((c) => (
                  <Select.Item key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          )}
        </div>

        <Textarea
          placeholder="What happened?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
        />
        <div>
          <Button
            size="small"
            disabled={!body.trim() || log.isPending}
            onClick={() => log.mutate()}
          >
            Log activity
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-muted">
            Loading timeline…
          </Text>
        </div>
      )}

      {!isLoading && activities.length === 0 && (
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-muted">
            Nothing logged yet. Every call, message and reply recorded here is
            what moves the conversation state.
          </Text>
        </div>
      )}

      {activities.map((a) => (
        <div key={a.id} className="flex flex-col gap-1 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="2xsmall" color={directionColor(a.direction) as any}>
              {a.direction}
            </Badge>
            {a.channel && <Badge size="2xsmall">{a.channel}</Badge>}
            <Text size="xsmall" className="text-ui-fg-muted">
              {formatWhen(a.occurred_at)}
            </Text>
          </div>
          <Text size="small">{a.summary || a.subject || a.kind || "—"}</Text>
          {a.body && (
            <Text size="xsmall" className="text-ui-fg-subtle whitespace-pre-wrap">
              {a.body}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
};
