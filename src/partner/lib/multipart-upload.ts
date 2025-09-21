export type InitiateResponse = {
  uploadId: string
  key: string
  bucket?: string
  region?: string
  partSize: number
}

export type PartUrl = { partNumber: number; url: string }

export async function initiateMultipart(file: File, folderPath?: string): Promise<InitiateResponse> {
  console.info("[multipart] initiate", { name: file.name, type: file.type, size: file.size, folderPath })
  const res = await fetch(`/api/partner/medias/uploads/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size, folderPath }),
    credentials: "include",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to initiate multipart upload")
  const json = await res.json()
  console.info("[multipart] initiate:response", json)
  return json
}

export async function getPartUrls(uploadId: string, key: string, partNumbers: number[]): Promise<{ urls: PartUrl[] }> {
  console.info("[multipart] parts", { uploadId, key: key.slice(0, 80), partNumbers })
  const res = await fetch(`/api/partner/medias/uploads/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, key, partNumbers }),
    credentials: "include",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to get part URLs")
  const json = await res.json()
  console.info("[multipart] parts:response", { urls: json?.urls?.length })
  return json
}

export async function uploadParts(file: File, urls: PartUrl[], partSize: number): Promise<{ PartNumber: number; ETag: string }[]> {
  // Upload sequentially or in small parallel batches to avoid saturating network
  const etags: { PartNumber: number; ETag: string }[] = []
  for (const { partNumber, url } of urls) {
    const start = (partNumber - 1) * partSize
    const end = Math.min(start + partSize, file.size)
    const chunk = file.slice(start, end)
    console.info("[multipart] upload part", { partNumber, start, end })
    const putRes = await fetch(url, { method: "PUT", body: chunk })
    if (!putRes.ok) throw new Error(`Failed to upload part ${partNumber}: ${await putRes.text()}`)
    const etag = putRes.headers.get("ETag") || putRes.headers.get("Etag") || ""
    if (!etag) throw new Error(`Missing ETag for part ${partNumber}`)
    etags.push({ PartNumber: partNumber, ETag: etag.replaceAll('"', '') })
  }
  return etags
}

export async function completeMultipart(
  uploadId: string,
  key: string,
  parts: { PartNumber: number; ETag: string }[],
  file: File
): Promise<{ s3: { location: string; key: string } }> {
  console.info("[multipart] complete", { uploadId, key: key.slice(0, 80), parts: parts.length, name: file.name })
  const res = await fetch(`/api/partner/medias/uploads/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, key, parts, name: file.name, type: file.type, size: file.size }),
    credentials: "include",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to complete multipart upload")
  const json = await res.json()
  console.info("[multipart] complete:response", json)
  return json
}

export async function uploadFileMultipart(file: File, folderPath?: string) {
  const init = await initiateMultipart(file, folderPath)
  const totalParts = Math.ceil(file.size / init.partSize)
  const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1)
  const { urls } = await getPartUrls(init.uploadId, init.key, partNumbers)
  const parts = await uploadParts(file, urls, init.partSize)
  const completed = await completeMultipart(init.uploadId, init.key, parts, file)
  return completed
}
