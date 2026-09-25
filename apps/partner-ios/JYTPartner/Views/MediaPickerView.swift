import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A picked file ready for upload.
struct MediaFilePick {
  let filename: String
  let mimeType: String
  let data: Data
}

/// Loads a PhotosPickerItem into uploadable data. Videos arrive as full
/// file data — same as the web's file input accepts.
enum MediaLoader {
  static func load(_ item: PhotosPickerItem) async -> MediaFilePick? {
    guard let data = try? await item.loadTransferable(type: Data.self),
          let identifier = item.itemIdentifier else { return nil }
    let type = item.supportedContentTypes.first ?? .jpeg
    let ext = type.preferredFilenameExtension ?? "jpg"
    let mimeType = type == .mpeg4Movie
      ? "video/mp4"
      : (type.preferredMIMEType ?? "image/jpeg")
    return MediaFilePick(
      filename: "upload-\(identifier).\(ext)",
      mimeType: mimeType,
      data: data
    )
  }
}

/// UIKit camera bridge — real devices only; the simulator reports no camera
/// source, so the action sheet omits the option there.
struct CameraPicker: UIViewControllerRepresentable {
  let onPicked: (MediaFilePick) -> Void
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let parent: CameraPicker
    init(_ parent: CameraPicker) { self.parent = parent }

    func imagePickerController(
      _ picker: UIImagePickerController,
      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
      let stamp = Int(Date().timeIntervalSince1970)
      if let image = info[.originalImage] as? UIImage,
         let data = image.jpegData(compressionQuality: 0.85) {
        parent.onPicked(MediaFilePick(
          filename: "camera-\(stamp).jpg",
          mimeType: "image/jpeg",
          data: data
        ))
      } else if let url = info[.mediaURL] as? URL,
                let data = try? Data(contentsOf: url) {
        let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
        parent.onPicked(MediaFilePick(
          filename: "camera-\(stamp).\(ext)",
          mimeType: ext.lowercased() == "mp4" ? "video/mp4" : "video/quicktime",
          data: data
        ))
      }
      parent.dismiss()
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      parent.dismiss()
    }
  }
}
