import { Input, Select } from "@medusajs/ui"
import { type Control, type UseFormWatch } from "react-hook-form"
import { Form } from "../common/form"

export type StorageProviderFieldValues = {
  provider_type: "s3" | "gcs" | "cloudinary" | "minio"
  access_key_id?: string
  secret_access_key?: string
  bucket?: string
  region?: string
  endpoint?: string
  cloud_name?: string
  api_key?: string
  api_secret?: string
  project_id?: string
}

type StorageProviderFieldsProps = {
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const StorageProviderFields = ({
  control,
  watch,
  isEditing,
}: StorageProviderFieldsProps) => {
  const providerType = watch("provider_type")

  return (
    <>
      <Form.Field
        control={control}
        name="provider_type"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Provider</Form.Label>
            <Form.Control>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isEditing}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select provider" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="s3">Amazon S3</Select.Item>
                  <Select.Item value="gcs">Google Cloud Storage</Select.Item>
                  <Select.Item value="cloudinary">Cloudinary</Select.Item>
                  <Select.Item value="minio">MinIO</Select.Item>
                </Select.Content>
              </Select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {(providerType === "s3" || providerType === "minio") && (
        <>
          <Form.Field
            control={control}
            name="access_key_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Access Key ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="AKIA..." />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="secret_access_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Secret Access Key
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Secret access key" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <Form.Field
              control={control}
              name="bucket"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Bucket</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="my-bucket" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={control}
              name="region"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Region</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="us-east-1" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>

          {providerType === "minio" && (
            <Form.Field
              control={control}
              name="endpoint"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Endpoint</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="https://minio.example.com" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          )}
        </>
      )}

      {providerType === "gcs" && (
        <>
          <Form.Field
            control={control}
            name="project_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Project ID</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="my-gcp-project" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="bucket"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Bucket</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="my-bucket" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  Service Account Key (JSON)
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Paste JSON key or path" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}

      {providerType === "cloudinary" && (
        <>
          <Form.Field
            control={control}
            name="cloud_name"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Cloud Name</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="my-cloud" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="api_key"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>API Key</Form.Label>
                <Form.Control>
                  <Input {...field} placeholder="Cloudinary API key" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <Form.Field
            control={control}
            name="api_secret"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>
                  API Secret
                  {isEditing && (
                    <span className="text-ui-fg-subtle ml-1">
                      (leave blank to keep existing)
                    </span>
                  )}
                </Form.Label>
                <Form.Control>
                  <Input {...field} type="password" placeholder="Cloudinary API secret" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </>
      )}
    </>
  )
}
