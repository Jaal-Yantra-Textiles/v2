import { useQueryParams } from "../../useQueryParams";
import { AdminTaskTemplate } from "../../api/task-templates";

type UseTaskTemplatesTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useTaskTemplatesTableQuery = ({
  prefix,
  pageSize = 20,
}: UseTaskTemplatesTableQueryProps) => {
  const queryObject = useQueryParams(
    [
      "offset",
      "name",
      "priority",
      "category",
      "order",
      "created_at",
      "updated_at"
    ],
    prefix,
  );

  const { 
    offset,
    name,
    priority,
    category,
    order,
    created_at,
    updated_at 
  } = queryObject;

  const searchParams: {
    limit: number;
    offset: number;
    name?: string;
    priority?: AdminTaskTemplate["priority"];
    category?: string;
    order?: string;
    created_at?: Record<string, Date>;
    updated_at?: Record<string, Date>;
  } = {
    limit: pageSize,
    offset: offset ? Number(offset) : 0,
    name,
    priority: priority as AdminTaskTemplate["priority"],
    category,
    order,
    created_at: created_at ? JSON.parse(created_at) : undefined,
    updated_at: updated_at ? JSON.parse(updated_at) : undefined,
  };

  return {
    searchParams,
    raw: queryObject,
  };
};
