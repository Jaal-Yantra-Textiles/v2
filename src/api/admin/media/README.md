# Media Upload API

This API allows uploading and organizing media files using the upload-and-organize-media workflow.

## Endpoint

```
POST /admin/media
```

## Authentication

Requires admin authentication with Bearer token.

## Request Format

The request should be sent as `multipart/form-data` with the following fields:

### Files

- `files` (required): Array of file objects to upload

### Folder Options

Either create a new folder or use an existing one:

- `folder[name]` (optional): Name for a new folder to create
- `folder[description]` (optional): Description for the new folder
- `existingFolderId` (optional): ID of an existing folder to use

### Album Options

Either create a new album or use existing ones:

- `album[name]` (optional): Name for a new album to create
- `album[description]` (optional): Description for the new album
- `album[type]` (optional): Type of album (gallery, portfolio, product, profile, general)
- `existingAlbumIds` (optional): Array of existing album IDs to associate files with

### Metadata

- `metadata` (optional): JSON object with additional metadata to attach to the media files

## Response Format

```json
{
  "message": "Media uploaded and organized successfully",
  "result": {
    "folder": {},
    "album": {},
    "mediaFiles": [],
    "uploadedFileCount": 0
  }
}
```

## Example Usage

### Upload files to a new folder and album

```bash
curl -X POST http://localhost:9000/admin/media \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -F "files=@image1.jpg" \
  -F "files=@image2.png" \
  -F "folder[name]=My Photos" \
  -F "album[name]=Summer Vacation" \
  -F "album[type]=gallery"
```

### Upload files to existing folder and albums

```bash
curl -X POST http://localhost:9000/admin/media \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -F "files=@document.pdf" \
  -F "existingFolderId=folder_12345" \
  -F "existingAlbumIds[]=album_67890" \
  -F "existingAlbumIds[]=album_54321" \
  -F "metadata[uploadedBy]=admin"
```

## Error Responses

- `400 Bad Request`: Missing files or invalid parameters
- `401 Unauthorized`: Missing or invalid authentication token
- `500 Internal Server Error`: Workflow execution failed
