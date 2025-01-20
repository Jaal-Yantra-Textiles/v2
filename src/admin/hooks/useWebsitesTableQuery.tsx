import { useQueryParams } from "./useQueryParams";
import { AdminWebsitesQuery } from "./api/websites";

interface UseWebsitesTableQueryProps {
  prefix?: string;
  pageSize?: number;
}

export const useWebsitesTableQuery = ({
  prefix,
  pageSize = 20,
}: UseWebsitesTableQueryProps) => {
  const queryObject = useQueryParams(
    ["offset", "q", "order", "domain", "name", "status"],
    prefix,
  );

  const { offset, domain, name, status, q } = queryObject;

  const searchParams: AdminWebsitesQuery = {
    limit: pageSize,
    offset: offset ? Number(offset) : 0,
    domain,
    name,
    status: status as AdminWebsitesQuery["status"],
    q,
  };

  return {
    searchParams,
    raw: queryObject,
  };
};
