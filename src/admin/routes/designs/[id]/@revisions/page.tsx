import { useParams, Link } from "react-router-dom";
import { Badge, Heading, StatusBadge, Text } from "@medusajs/ui";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { useDesignRevisions } from "../../../../hooks/api/designs";

const statusColor = (status: string) => {
  switch (status) {
    case "Approved":
    case "Commerce_Ready":
      return "green";
    case "In_Development":
    case "Technical_Review":
    case "Sample_Production":
      return "orange";
    case "Superseded":
      return "grey";
    case "Rejected":
      return "red";
    default:
      return "grey";
  }
};

export default function RevisionHistoryPage() {
  const { id } = useParams();
  const { lineage, root_design_id, isLoading, isError } =
    useDesignRevisions(id!);

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Revision History</Heading>
      </RouteDrawer.Header>
      <RouteDrawer.Body>
        <div className="p-6">
          {isLoading && (
            <Text className="text-ui-fg-muted">Loading...</Text>
          )}
          {isError && (
            <Text className="text-ui-fg-error">
              Failed to load revision history
            </Text>
          )}
          {lineage && lineage.length > 0 && (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[11px] top-3 bottom-3 w-px bg-ui-border-base" />

              <div className="flex flex-col gap-y-0">
                {lineage.map((entry, index) => {
                  const isCurrent = entry.id === id;
                  const isFirst = index === 0;
                  const isLast = index === lineage.length - 1;

                  return (
                    <div key={entry.id} className="relative flex gap-x-4">
                      {/* Timeline dot */}
                      <div className="relative z-10 flex-shrink-0 mt-1.5">
                        <div
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            isCurrent
                              ? "border-ui-fg-interactive bg-ui-bg-interactive"
                              : "border-ui-border-strong bg-ui-bg-base"
                          }`}
                        >
                          <Text
                            size="xsmall"
                            weight="plus"
                            className={
                              isCurrent ? "text-ui-fg-on-color" : "text-ui-fg-subtle"
                            }
                          >
                            {entry.revision_number || 1}
                          </Text>
                        </div>
                      </div>

                      {/* Content */}
                      <div
                        className={`flex-1 pb-6 ${
                          isCurrent
                            ? "bg-ui-bg-subtle rounded-lg p-4 -mt-1 mb-2"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-x-2 flex-wrap">
                          {isCurrent ? (
                            <Text size="small" weight="plus">
                              {entry.name}
                            </Text>
                          ) : (
                            <Link
                              to={`/designs/${entry.id}`}
                              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover text-sm font-medium"
                            >
                              {entry.name}
                            </Link>
                          )}
                          <StatusBadge color={statusColor(entry.status)}>
                            {entry.status?.replace(/_/g, " ")}
                          </StatusBadge>
                          {isCurrent && (
                            <Badge color="blue" className="text-xs">
                              Current
                            </Badge>
                          )}
                        </div>

                        <Text
                          size="xsmall"
                          className="text-ui-fg-muted mt-1"
                        >
                          {new Date(entry.created_at).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </Text>

                        {entry.revision_notes && (
                          <Text
                            size="small"
                            className="text-ui-fg-subtle mt-2"
                          >
                            {entry.revision_notes}
                          </Text>
                        )}

                        {isFirst && !entry.revised_from_id && (
                          <Badge color="green" className="mt-2 text-xs">
                            Original
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {lineage && lineage.length === 0 && (
            <Text className="text-ui-fg-muted">No revision history</Text>
          )}
        </div>
      </RouteDrawer.Body>
    </RouteDrawer>
  );
}
