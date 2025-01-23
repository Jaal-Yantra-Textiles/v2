import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityActions } from "../persons/personsActions";
import { CardKey } from "../../hooks/cards/useWebsiteCardKeys";
import { format } from "date-fns";
import { AdminWebsite } from "../../hooks/api/websites";
import { ReactNode } from "react";

type EntityAction = {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledTooltip?: string | ReactNode;
} & (
  | {
      to: (entity: AdminWebsite) => string;
      onClick?: never;
    }
  | {
      onClick: (entity: AdminWebsite) => void;
      to?: never;
    }
);

interface WebsiteCardProps {
  website: AdminWebsite;
  cardKeys: CardKey[];
  actionsConfig: {
    actions: EntityAction[];
  };
}

export function WebsiteCard({ website, cardKeys, actionsConfig }: WebsiteCardProps) {

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "Active":
        return "default";
      case "Inactive":
        return "destructive";
      case "Maintenance":
        return "outline";
      default:
        return "secondary";
    }
  };

  const formatValue = (key: CardKey, value: any) => {
    if (!value) return "N/A";

    switch (key.type) {
      case "date":
        return format(new Date(value), "PPP");
      case "select":
        return key.options?.find((opt) => opt.value === value)?.label || value;
      default:
        return value;
    }
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{website.name}</CardTitle>
          <Badge variant={getStatusVariant(website.status as string)}>
            {website.status}
          </Badge>
        </div>
        <CardDescription className="text-sm">
          <a
            href={`https://${website.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {website.domain}
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="space-y-2">
          {cardKeys
            .filter((key) => key.key !== "name" && key.key !== "domain" && key.key !== "status" 
                              && key.key !== "created_at" 
          )
            .map((key) => (
              <div key={key.key} className="text-sm">
                <span className="font-medium">{key.label}:</span>{" "}
                {formatValue(key, website[key.key as keyof AdminWebsite])}
              </div>
            ))}
        </div>
        <div className="flex justify-end">
          <EntityActions entity={website} actionsConfig={actionsConfig} />
        </div>
      </CardContent>
    </Card>
  );
}
