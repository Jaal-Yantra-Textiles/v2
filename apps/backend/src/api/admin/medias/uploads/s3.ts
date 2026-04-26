import { S3Client } from "@aws-sdk/client-s3"

export interface S3Config {
  region: string
  bucket: string
  endpoint?: string
  forcePathStyle?: boolean
  accessKeyId?: string
  secretAccessKey?: string
}

let cached: { client: S3Client; cfg: S3Config } | null = null

export function getS3Config(): S3Config {
  const region = process.env.AWS_REGION || process.env.S3_REGION || "us-east-1"
  const bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || ""
  const endpoint = process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE || "").toLowerCase() === "true"
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY

  if (!bucket) {
    throw new Error("S3 bucket not configured (S3_BUCKET/AWS_S3_BUCKET)")
  }

  return { region, bucket, endpoint, forcePathStyle, accessKeyId, secretAccessKey }
}

export function getS3Client(): { client: S3Client; cfg: S3Config } {
  if (cached) return cached
  const cfg = getS3Config()
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
  })
  cached = { client, cfg }
  return cached
}

export function getPublicUrl(key: string): string {
  const { cfg } = getS3Client()
  const normalizedKey = key.replace(/^\/+/, "")
  if (cfg.endpoint) {
    // Path-style with custom endpoint (e.g., MinIO/Supabase-compatible)
    const base = cfg.endpoint.replace(/\/$/, "")
    return `${base}/${cfg.bucket}/${normalizedKey}`
  }
  // Standard AWS virtual-hosted-style URL
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${normalizedKey}`
}
