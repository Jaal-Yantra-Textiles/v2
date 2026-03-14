import { useQueryParams } from "../../../../hooks/useQueryParams"

export const useSocialPlatformTableQuery = ({ pageSize = 20 }) => {
  const query = useQueryParams(["q", "offset"])

  return {
    ...query,
    search: query.q,
    pageSize: pageSize,
  }
}
