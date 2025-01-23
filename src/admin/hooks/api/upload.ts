import { FetchError } from "@medusajs/js-sdk";
import { HttpTypes, SelectParams } from "@medusajs/types";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/sdk";
import { queryKeysFactory } from "../../lib/query-key-factory";

export type BaseUploadFile = HttpTypes.AdminUploadFile;

export interface AdminUploadResponse {
  files: HttpTypes.AdminFile[];
}

export interface AdminUploadFileResponse {
  file: HttpTypes.AdminFile;
}

const UPLOAD_QUERY_KEY = "uploads" as const;
export const uploadQueryKeys = queryKeysFactory(UPLOAD_QUERY_KEY);

export const useFileUpload = (
  options?: UseMutationOptions<
    AdminUploadResponse,
    FetchError,
    BaseUploadFile
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      return sdk.admin.upload.create(data);
    },
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: [UPLOAD_QUERY_KEY] });
      if (options?.onSuccess) {
        options.onSuccess(...args);
      }
    },
  });
};

export const useGetUploadedFile = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      AdminUploadFileResponse,
      FetchError,
      AdminUploadFileResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: uploadQueryKeys.detail(id),
    queryFn: () => sdk.admin.upload.retrieve(id),
    ...options,
  });

  return { ...data, ...rest };
};

export const useDeleteUploadedFile = (
  id: string,
  options?: UseMutationOptions<HttpTypes.AdminFileDeleteResponse, FetchError, void>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return sdk.admin.upload.delete(id);
    },
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: [UPLOAD_QUERY_KEY] });
      if (options?.onSuccess) {
        options.onSuccess(...args);
      }
    },
  });
};