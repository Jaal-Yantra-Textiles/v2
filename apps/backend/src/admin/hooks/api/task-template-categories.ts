import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseQueryOptions,
  useQuery,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface TaskTemplateCategory {
  id: string;
  name: string;
  description?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface TaskTemplateCategoriesResponse {
  categories: TaskTemplateCategory[];
  count: number;
  offset: number;
  limit: number;
}

const TASK_TEMPLATE_CATEGORIES_QUERY_KEY = "task-template-categories" as const;
export const taskTemplateCategoriesQueryKeys = queryKeysFactory(TASK_TEMPLATE_CATEGORIES_QUERY_KEY);

type TaskTemplateCategoriesParams = {
  limit?: number;
  offset?: number;
  name?: string;
  created_at?: Record<string, Date>;
  updated_at?: Record<string, Date>;
};

export const useTaskTemplateCategories = (
  params?: TaskTemplateCategoriesParams,
  options?: Omit<
    UseQueryOptions<
      TaskTemplateCategoriesResponse,
      FetchError,
      TaskTemplateCategoriesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: taskTemplateCategoriesQueryKeys.lists(),
    queryFn: async () =>
      sdk.client.fetch<TaskTemplateCategoriesResponse>(
        `/admin/task-templates/categories`,
        {
          method: "GET",
          query: params,
        },
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useTaskTemplateCategory = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      { category: TaskTemplateCategory },
      FetchError,
      { category: TaskTemplateCategory },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: taskTemplateCategoriesQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ category: TaskTemplateCategory }>(
        `/admin/task-templates/categories/${id}`,
        {
          method: "GET",
        },
      ),
    ...options,
  });
  return { ...data, ...rest };
};
