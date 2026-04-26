import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseQueryOptions,
  useQuery,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

// Define the type for a single category name
export type BlogCategory = string;

// Define the response type for the categories endpoint
export interface AdminBlogCategoriesResponse {
  categories: string[]; // API returns an array of category names
}

const BLOG_CATEGORIES_QUERY_KEY = "blog_categories" as const;
export const blogCategoryQueryKeys = queryKeysFactory(BLOG_CATEGORIES_QUERY_KEY);

// Create the custom hook to fetch blog categories
export const useBlogCategories = (
  websiteId: string,
  options?: Omit<
    UseQueryOptions<AdminBlogCategoriesResponse, FetchError, AdminBlogCategoriesResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: blogCategoryQueryKeys.list({ websiteId }),
    queryFn: async () =>
      sdk.client.fetch<AdminBlogCategoriesResponse>(
        `/admin/websites/${websiteId}/blogs/categories`,
        {
          method: "GET",
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};
