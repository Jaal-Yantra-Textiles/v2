package com.jyt.partner.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Media folders shared with this partner — the /partners/shared-folders
 *  surface. Files live in S3 (uploaded through the multipart presigned
 *  flow) and are registered against the folder afterwards. */
@Serializable
data class SharedFolder(
    val id: String,
    val name: String,
    val slug: String? = null,
    val description: String? = null,
    val path: String? = null,
    @SerialName("is_public") val isPublic: Boolean = false,
    @SerialName("media_files") val mediaFiles: List<SharedFolderMediaFile> = emptyList(),
    @SerialName("assigned_persons") val assignedPersons: List<SharedFolderPerson> = emptyList(),
)

@Serializable
data class SharedFolderPerson(
    val id: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
)

@Serializable
data class SharedFolderMediaFile(
    val id: String,
    @SerialName("file_name") val fileName: String? = null,
    @SerialName("original_name") val originalName: String? = null,
    @SerialName("file_path") val filePath: String? = null,
    @SerialName("file_type") val fileType: String? = null,
    @SerialName("mime_type") val mimeType: String? = null,
    @SerialName("file_size") val fileSize: Long? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class SharedFolderListResponse(
    @SerialName("shared_folders") val sharedFolders: List<SharedFolder> = emptyList(),
)

@Serializable
data class SharedFolderDetailResponse(
    @SerialName("shared_folder") val sharedFolder: SharedFolder,
)

/** A comment left on one file in the folder. */
@Serializable
data class FolderMediaComment(
    val id: String,
    val content: String? = null,
    @SerialName("author_type") val authorType: String? = null,
    @SerialName("author_name") val authorName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class FolderMediaCommentsResponse(
    val comments: List<FolderMediaComment> = emptyList(),
)

@Serializable
data class AddFolderCommentBody(val content: String)

// ── The multipart presigned upload contract (/partners/medias/uploads/*) ──

@Serializable
data class InitiateUploadResponse(
    @SerialName("uploadId") val uploadId: String,
    val key: String,
    @SerialName("partSize") val partSize: Long,
)

@Serializable
data class UploadPartUrl(
    @SerialName("partNumber") val partNumber: Int,
    val url: String,
)

@Serializable
data class UploadPartsResponse(val urls: List<UploadPartUrl> = emptyList())

/** S3's own casing — the complete route expects PartNumber/ETag verbatim. */
@Serializable
data class UploadedPart(
    @SerialName("PartNumber") val partNumber: Int,
    @SerialName("ETag") val etag: String,
)

@Serializable
data class CompleteUploadBody(
    @SerialName("uploadId") val uploadId: String,
    val key: String,
    val parts: List<UploadedPart>,
    val name: String,
    val type: String,
    val size: Long,
)

@Serializable
data class CompleteUploadResponse(val s3: S3Location) {
    @Serializable
    data class S3Location(val location: String, val key: String)
}

/** Registers a completed S3 upload against the folder. */
@Serializable
data class RegisterFolderUploadBody(
    val key: String,
    val url: String,
    val filename: String,
    val mimeType: String,
    val size: Long,
)

@Serializable
data class RegisterFolderUploadResponse(
    val message: String? = null,
    @SerialName("media_file") val mediaFile: SharedFolderMediaFile? = null,
)
