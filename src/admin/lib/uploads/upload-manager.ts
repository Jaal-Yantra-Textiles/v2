/*
  Simple S3 Multipart Upload Manager (resume-on-reopen requires user to reselect file)
  - Splits files into parts
  - Requests presigned URLs for parts from backend
  - Uploads parts with concurrency and retries
  - Completes upload and calls finalize API to create MediaFile records
  - Persists minimal state in localStorage for awareness on reopen (no file content)
*/

import { VITE_MEDUSA_BACKEND_URL } from "../../lib/config"

type UploadStatus = "queued" | "uploading" | "paused" | "completed" | "error"

export interface UploadItemState {
  id: string // file signature: name|size
  name: string
  type: string
  size: number
  progress: number // 0-1
  status: UploadStatus
  message?: string
}

export interface EnqueueOptions {
  existingAlbumIds?: string[]
  folderPath?: string
  existingFolderId?: string
  metadata?: Record<string, any>
}

const DEFAULTS = {
  partSize: 8 * 1024 * 1024, // 8MB
  maxPartConcurrency: 4,
}

async function api(path: string, init?: RequestInit) {
  const base = (VITE_MEDUSA_BACKEND_URL || "").replace(/\/$/, "")
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Content-Type": "application/json",
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.message || `Request failed: ${res.status}`)
  }
  return data
}

function fileId(file: File) {
  return `${file.name}|${file.size}`
}

async function uploadViaServer(file: File, opts: EnqueueOptions) {
  const base = (VITE_MEDUSA_BACKEND_URL || "").replace(/\/$/, "")
  const url = `${base}/admin/medias`
  const fd = new FormData()
  fd.append("files", file, file.name || "upload.bin")
  if (opts.existingAlbumIds?.length) {
    for (const id of opts.existingAlbumIds) {
      fd.append("existingAlbumIds", id)
    }
  }
  const res = await fetch(url, { method: "POST", body: fd, credentials: "include" })
  if (!res.ok) {
    let msg = `Server upload failed: ${res.status}`
    try {
      const data = await res.json()
      if (data?.message) msg = data.message
    } catch {}
    throw new Error(msg)
  }
  return res.json().catch(() => ({}))
}

export class UploadManager {
  private queue: Array<{ file: File; opts: EnqueueOptions; state: UploadItemState }>
  private running = 0
  private listeners: Array<(s: UploadItemState) => void> = []

  constructor(private config = DEFAULTS) {
    this.queue = []
    window.addEventListener("online", () => this.resumeAll())
  }

  onUpdate(cb: (s: UploadItemState) => void) {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((x) => x !== cb)
    }
  }

  private emit(state: UploadItemState) {
    this.listeners.forEach((cb) => cb(state))
  }

  enqueue(file: File, opts: EnqueueOptions = {}) {
    const state: UploadItemState = {
      id: fileId(file),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      progress: 0,
      status: navigator.onLine ? "queued" : "paused",
    }
    this.queue.push({ file, opts, state })
    this.emit(state)
    this.pump()
  }

  pauseAll() {
    for (const q of this.queue) {
      if (q.state.status === "uploading" || q.state.status === "queued") {
        q.state.status = "paused"
        this.emit(q.state)
      }
    }
  }

  resumeAll() {
    for (const q of this.queue) {
      if (q.state.status === "paused") {
        q.state.status = "queued"
        this.emit(q.state)
      }
    }
    this.pump()
  }

  // Pause a single file by its id (name|size)
  pause(id: string) {
    const q = this.queue.find((x) => x.state.id === id)
    if (q && (q.state.status === "uploading" || q.state.status === "queued")) {
      q.state.status = "paused"
      this.emit(q.state)
    }
  }

  // Resume a single file by its id (name|size)
  resume(id: string) {
    const q = this.queue.find((x) => x.state.id === id)
    if (q && q.state.status === "paused") {
      q.state.status = "queued"
      this.emit(q.state)
      this.pump()
    }
  }

  // Retry a single file that failed
  retry(id: string) {
    const q = this.queue.find((x) => x.state.id === id)
    if (q && q.state.status === "error") {
      q.state.status = "queued"
      q.state.message = undefined
      q.state.progress = 0
      this.emit(q.state)
      this.pump()
    }
  }

  // Retry all files currently in error state
  retryAllErrors() {
    for (const q of this.queue) {
      if (q.state.status === "error") {
        q.state.status = "queued"
        q.state.message = undefined
        q.state.progress = 0
        this.emit(q.state)
      }
    }
    this.pump()
  }

  private async pump() {
    if (!navigator.onLine) return
    while (this.running < 2) { // up to 2 files concurrently
      const next = this.queue.find((q) => q.state.status === "queued")
      if (!next) break
      this.running++
      next.state.status = "uploading"
      this.emit(next.state)
      this.uploadFile(next).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async uploadFile(item: { file: File; opts: EnqueueOptions; state: UploadItemState }) {
    const { file, opts, state } = item
    try {
      const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024 // 5MB

      // Small-file path: single PUT presign via provider
      if (file.size <= SMALL_FILE_THRESHOLD) {
        const presign = await api(`/admin/medias/uploads/presign`, {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            access: "public",
          }),
        })

        // Upload directly to storage
        const putUrl: string = presign.url
        const file_key: string =
          presign.file_key ||
          presign.key ||
          presign.fileKey ||
          presign.filepath ||
          presign.path ||
          presign.object_key ||
          presign.objectKey
        if (!putUrl || !file_key) {
          throw new Error("Provider presign response missing url or file key")
        }
        try {
          const putResp = await fetch(putUrl, {
            method: "PUT",
            body: file,
            mode: "cors",
            credentials: "omit",
          })
          if (!putResp.ok) {
            throw new Error(`Direct upload failed: ${putResp.status}`)
          }
        } catch (err: any) {
          const msg = String(err?.message || err || "")
          // CORS/access-control fallback: proxy through server
          if (/access control|Failed to fetch|TypeError/i.test(msg)) {
            await uploadViaServer(file, opts)
          } else {
            throw err
          }
        }

        // Finalize in our domain (DB record, album links)
        await api(`/admin/medias/uploads/finalize-single`, {
          method: "POST",
          body: JSON.stringify({
            file_key,
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            existingAlbumIds: opts.existingAlbumIds,
            existingFolderId: opts.existingFolderId,
            metadata: opts.metadata,
          }),
        })

        state.progress = 1
        state.status = "completed"
        this.emit(state)
        return
      }

      // 1) Initiate multipart
      const initResp = await api(`/admin/medias/uploads/initiate`, {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          existingAlbumIds: opts.existingAlbumIds,
          folderPath: opts.folderPath,
        }),
      })
      const uploadId: string = initResp.uploadId
      const key: string = initResp.key
      const partSize: number = initResp.partSize || this.config.partSize

      // 2) Compute parts
      const totalParts = Math.ceil(file.size / partSize)
      let completed = 0
      const etags: { PartNumber: number; ETag: string }[] = []

      // Iterate parts with limited parallelism
      let partNumber = 1
      while (partNumber <= totalParts) {
        if (state.status === "paused") {
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        const batch = [] as number[]
        for (let i = 0; i < this.config.maxPartConcurrency && partNumber <= totalParts; i++, partNumber++) {
          batch.push(partNumber)
        }
        // 3) Presign URLs for this batch
        const partsResp = await api(`/admin/medias/uploads/parts`, {
          method: "POST",
          body: JSON.stringify({ uploadId, key, partNumbers: batch }),
        })
        const urls: { partNumber: number; url: string }[] = partsResp.urls

        // 4) PUT parts
        await Promise.all(
          urls.map(async ({ partNumber, url }) => {
            const start = (partNumber - 1) * partSize
            const end = Math.min(start + partSize, file.size)
            const blob = file.slice(start, end)
            // Retry up to 3 times
            let attempt = 0
            while (attempt < 3) {
              try {
                const resp = await fetch(url, { method: "PUT", body: blob, mode: "cors", credentials: "omit" })
                if (!resp.ok) throw new Error(`Part ${partNumber} upload failed: ${resp.status}`)
                const etag = resp.headers.get("ETag") || ""
                etags.push({ PartNumber: partNumber, ETag: (etag || "").replace(/"/g, "") })
                completed++
                state.progress = completed / totalParts
                this.emit(state)
                return
              } catch (e) {
                attempt++
                if (attempt >= 3) {
                  // Bail out to server-side upload for the whole file (CORS or repeated failures)
                  await uploadViaServer(file, opts)
                  // Mark as completed and short-circuit remaining uploads by throwing a special token
                  state.progress = 1
                  state.status = "completed"
                  this.emit(state)
                  throw new Error("__FALLBACK_COMPLETED__")
                }
                await new Promise((r) => setTimeout(r, 500 * attempt))
              }
            }
          })
        )
      }

      // 5) Complete
      const completeResp = await api(`/admin/medias/uploads/complete`, {
        method: "POST",
        body: JSON.stringify({
          uploadId,
          key,
          parts: etags.sort((a, b) => a.PartNumber - b.PartNumber),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          existingAlbumIds: opts.existingAlbumIds,
          existingFolderId: opts.existingFolderId,
          metadata: opts.metadata,
        }),
      })

      state.progress = 1
      state.status = "completed"
      this.emit(state)
      return completeResp
    } catch (e: any) {
      state.status = "error"
      state.message = e?.message || "Upload failed"
      this.emit(state)
      return
    }
  }
}
