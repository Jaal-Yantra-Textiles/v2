import { QueryKey, UseQueryOptions } from "@tanstack/react-query";

export type TQueryKey<TKey, TListQuery = any, TDetailQuery = string> = {
  all: readonly [TKey];
  lists: () => readonly [...TQueryKey<TKey>["all"], "list"];
  list: (query?: TListQuery) => readonly [TKey, "list", { query: TListQuery }];
  details: () => readonly [...TQueryKey<TKey>["all"], "detail"];
  detail: (
    id: TDetailQuery,
    query?: TListQuery,
  ) => readonly [TKey, "detail", TDetailQuery, { query: TListQuery }];
};

export type UseQueryOptionsWrapper<
  TQueryFn = unknown,
  E = Error,
  TQueryKey extends QueryKey = QueryKey,
> = Omit<
  UseQueryOptions<TQueryFn, E, TQueryFn, TQueryKey>,
  "queryKey" | "queryFn"
>;

export const queryKeysFactory = <
  T,
  TListQueryType = any,
  TDetailQueryType = string,
>(
  globalKey: T,
): TQueryKey<T, TListQueryType, TDetailQueryType> => {
  const queryKeyFactory: TQueryKey<T, TListQueryType, TDetailQueryType> = {
    all: [globalKey] as const,

    lists: () => {
      return [...queryKeyFactory.all, "list"] as const;
    },

    list: (query?: TListQueryType) => {
      return [
        globalKey,
        "list",
        { query: query ?? ({} as TListQueryType) },
      ] as const;
    },

    details: () => {
      return [...queryKeyFactory.all, "detail"] as const;
    },

    detail: (id: TDetailQueryType, query?: TListQueryType) => {
      return [
        globalKey,
        "detail",
        id,
        { query: query ?? ({} as TListQueryType) },
      ] as const;
    },
  };

  return queryKeyFactory;
};
