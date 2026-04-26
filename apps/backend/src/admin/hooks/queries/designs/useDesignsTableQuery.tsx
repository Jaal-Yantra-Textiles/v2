import { useQueryParams } from "../../useQueryParams";
import { AdminDesignsQuery } from "../../api/designs";

type UseDesignsTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useDesignsTableQuery = ({
  prefix,
  pageSize = 20,
}: UseDesignsTableQueryProps) => {
  const queryObject = useQueryParams(
    [
      "offset",
      "status",
      "design_type",
      "priority",
      "tags",
      "name",
      "order",
      "created_at",
      "updated_at"
    ],
    prefix,
  );

  const { 
    offset,
    status,
    design_type,
    priority,
    tags,
    name,
    order,
    created_at,
    updated_at 
  } = queryObject;

  const searchParams: AdminDesignsQuery & {
    order?: string;
    created_at?: Record<string, Date>;
    updated_at?: Record<string, Date>;
  } = {
    limit: pageSize,
    offset: offset ? Number(offset) : 0,
    status: status as AdminDesignsQuery["status"],
    design_type: design_type as AdminDesignsQuery["design_type"],
    priority: priority as AdminDesignsQuery["priority"],
    tags: tags ? JSON.parse(tags) : undefined,
    name,
    order,
    created_at: created_at ? JSON.parse(created_at) : undefined,
    updated_at: updated_at ? JSON.parse(updated_at) : undefined,
  };

  return {
    searchParams,
    raw: queryObject,
  };
};
