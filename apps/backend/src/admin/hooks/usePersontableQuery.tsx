import { AdminPersonsListParams } from "./api/personandtype";
import { useQueryParams } from "./useQueryParams";

type UsePersonTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const usePersonsTableQuery = ({
  prefix,
  pageSize = 20,
}: UsePersonTableQueryProps) => {
  const queryObject = useQueryParams(
    ["offset", "q", "order", "created_at", "updated_at", "email", "date_of_birth", "state"],
    prefix,
  );

  const { 
    offset, 
    created_at, 
    updated_at, 
    q, 
    order,
    email,
    date_of_birth,
    state
  } = queryObject;

  const filters: Record<string, any> = {};

  // Add search query if present
  if (q) {
    filters.q = q;
  }

  // Add other filters if present
  if (email) filters.email = email;
  if (date_of_birth) filters.date_of_birth = new Date(date_of_birth);
  if (state) filters.state = state;
  if (created_at) filters.created_at = JSON.parse(created_at);
  if (updated_at) filters.updated_at = JSON.parse(updated_at);

  const searchParams: AdminPersonsListParams = {
    limit: pageSize,
    created_at: created_at ? JSON.parse(created_at) : undefined,
    updated_at: updated_at ? JSON.parse(updated_at) : undefined,
    offset: offset ? Number(offset) : 0,
    order,
    ...filters
  };

  return {
    searchParams,
    raw: queryObject,
  };
};
