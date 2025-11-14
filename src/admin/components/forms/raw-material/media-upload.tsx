import { CheckCircleSolid, FolderOpen, Photo } from "@medusajs/icons"
import { Button, Text, Tooltip, Select, Input } from "@medusajs/ui"
import { useMediaFiles, useFolders, useAlbums, MediaFile, MediaFolder } from "../../../hooks/api/media"
import { RoundSpinner } from "../../ui/spinner"
import { getThumbUrl, isImageUrl } from "../../../lib/media"
import { useState, useMemo, useRef, useEffect } from "react"

// Optimized thumbnail component with intersection observer for lazy loading
interface MediaThumbnailProps {
  file: MediaFile
  isSelected: boolean
  onSelect: () => void
}

const MediaThumbnail = ({ file, isSelected, onSelect }: MediaThumbnailProps) => {
  const [isVisible, setIsVisible] = useState(false)
  const imgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!imgRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true)
            observer.disconnect()
          }
        })
      },
      {
        rootMargin: "50px", // Load images 50px before they enter viewport
      }
    )

    observer.observe(imgRef.current)

    return () => observer.disconnect()
  }, [])

  const fileUrl = `${process.env.NEXT_PUBLIC_AWS_S3 || ""}${file.file_path}`
  const displayName = file.original_name || file.file_name

  // Smaller thumbnails: 80px at 60% quality (was 128px at 70%)
  const thumbnailUrl = isImageUrl(fileUrl)
    ? getThumbUrl(fileUrl, { width: 80, quality: 60, fit: "cover" })
    : fileUrl

  return (
    <Tooltip content={displayName}>
      <div
        ref={imgRef}
        onClick={onSelect}
        className="relative h-20 w-20 cursor-pointer overflow-hidden rounded border bg-ui-bg-subtle shadow-sm"
      >
        {isSelected && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <CheckCircleSolid className="text-ui-fg-on-color" />
          </div>
        )}
        {isVisible ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbnailUrl}
            alt={displayName}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ui-bg-subtle">
            <div className="h-4 w-4 animate-pulse rounded bg-ui-bg-subtle-hover" />
          </div>
        )}
      </div>
    </Tooltip>
  )
}

interface MediaUploadProps {
  selectedUrls: string[]
  handleSelect: (url: string) => void
}

const MediaUpload = ({ selectedUrls, handleSelect }: MediaUploadProps) => {
  // Filter state
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [albumId, setAlbumId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState<string>("")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [showFolders] = useState(true)

  // Fetch data
  const { data: foldersData } = useFolders()
  const { data: albumsData } = useAlbums()
  
  const folders = foldersData?.folders || []
  const albums = albumsData?.albums || []
  
  const {
    files,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMediaFiles({
    folder_id: folderId,
    album_id: albumId,
    search: search || undefined,
    created_after: dateFrom || undefined,
    created_before: dateTo || undefined,
    limit: 40,
  })

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (folderId) count++
    if (albumId) count++
    if (search) count++
    if (dateFrom || dateTo) count++
    return count
  }, [folderId, albumId, search, dateFrom, dateTo])

  // Clear all filters
  const clearFilters = () => {
    setFolderId(undefined)
    setAlbumId(undefined)
    setSearch("")
    setDateFrom("")
    setDateTo("")
  }

  // Get folders in current folder (for navigation)
  const currentFolderSubfolders = useMemo(() => {
    if (!folders || !showFolders) return []
    return folders.filter((f: MediaFolder) => f.parent_folder_id === folderId)
  }, [folders, folderId, showFolders])

  // Handle folder navigation
  const navigateToFolder = (newFolderId?: string) => {
    setFolderId(newFolderId)
  }

  // Get current folder for breadcrumb
  const currentFolder = folders.find((f) => f.id === folderId)

  if (isError) {
    return (
      <div className="p-8">
        <Text className="text-ui-fg-error">Failed to load files.</Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4 p-6">
      {/* Filter Section */}
      <div className="flex flex-col gap-3 border-b pb-4">
        <div className="flex items-center justify-between">
          <Text weight="plus" size="small">Filters</Text>
          {activeFiltersCount > 0 && (
            <Button
              variant="transparent"
              size="small"
              onClick={clearFilters}
            >
              Clear all ({activeFiltersCount})
            </Button>
          )}
        </div>
        
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          {/* Folder Filter */}
          <div>
            <Text size="xsmall" className="mb-1 text-ui-fg-subtle">Folder</Text>
            <Select 
              value={folderId || "all"} 
              onValueChange={(val) => setFolderId(val === "all" ? undefined : val)}
              disabled={isLoading}
            >
              <Select.Trigger>
                <Select.Value placeholder="All Folders" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="all">All Folders</Select.Item>
                {folders.map((folder) => (
                  <Select.Item key={folder.id} value={folder.id}>
                    {folder.path}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          {/* Album Filter */}
          <div>
            <Text size="xsmall" className="mb-1 text-ui-fg-subtle">Album</Text>
            <Select 
              value={albumId || "all"} 
              onValueChange={(val) => setAlbumId(val === "all" ? undefined : val)}
              disabled={isLoading}
            >
              <Select.Trigger>
                <Select.Value placeholder="All Albums" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="all">All Albums</Select.Item>
                {albums.map((album) => (
                  <Select.Item key={album.id} value={album.id}>
                    {album.name} ({album.type})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          {/* Search */}
          <div>
            <Text size="xsmall" className="mb-1 text-ui-fg-subtle">Search</Text>
            <Input
              type="text"
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="small"
              disabled={isLoading}
            />
          </div>

          {/* Date Range */}
          <div className="flex gap-1">
            <div className="flex-1">
              <Text size="xsmall" className="mb-1 text-ui-fg-subtle">From</Text>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                size="small"
                disabled={isLoading}
              />
            </div>
            <div className="flex-1">
              <Text size="xsmall" className="mb-1 text-ui-fg-subtle">To</Text>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                size="small"
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        {currentFolder && (
          <div className="flex items-center gap-2 text-sm">
            <Button
              variant="transparent"
              size="small"
              onClick={() => navigateToFolder(undefined)}
            >
              Root
            </Button>
            <Text size="small" className="text-ui-fg-subtle">/</Text>
            <Text size="small" weight="plus">{currentFolder.name}</Text>
          </div>
        )}
      </div>

      {/* Files and Folders Grid */}
      <div className="relative min-h-[400px]">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-ui-bg-base/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <RoundSpinner />
              <Text size="small" className="text-ui-fg-subtle">Loading files...</Text>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {/* Subfolders (if any) */}
          {currentFolderSubfolders.map((folder) => (
          <Tooltip content={`Folder: ${folder.name}`} key={folder.id}>
            <div
              onClick={() => navigateToFolder(folder.id)}
              className="relative flex h-20 w-20 cursor-pointer flex-col items-center justify-center overflow-hidden rounded border border-dashed bg-ui-bg-subtle shadow-sm hover:bg-ui-bg-subtle-hover"
            >
              <FolderOpen className="text-ui-fg-muted mb-1" />
              <Text size="xsmall" className="truncate px-1 text-center">{folder.name}</Text>
            </div>
          </Tooltip>
        ))}

        {/* Files */}
        {files.map((file: MediaFile) => (
          <MediaThumbnail
            key={file.id}
            file={file}
            isSelected={selectedUrls.includes(`${process.env.NEXT_PUBLIC_AWS_S3 || ""}${file.file_path}`)}
            onSelect={() => handleSelect(`${process.env.NEXT_PUBLIC_AWS_S3 || ""}${file.file_path}`)}
          />
        ))}

          {/* Empty State */}
          {!isLoading && files.length === 0 && currentFolderSubfolders.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-12">
              <Photo className="text-ui-fg-muted mb-2" />
              <Text size="small" className="text-ui-fg-subtle">
                {activeFiltersCount > 0 ? "No files match your filters" : "No files found"}
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* Load More */}
      {hasNextPage && !isLoading && (
        <Button
          variant="secondary"
          size="small"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
          className="self-center"
        >
          {isFetchingNextPage ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  )
}

export default MediaUpload;
