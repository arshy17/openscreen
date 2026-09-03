import AppKit
import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

private struct PickedFile: Transferable {
	let url: URL
	let contentType: UTType

	static var transferRepresentation: some TransferRepresentation {
		FileRepresentation(contentType: .movie) { value in
			SentTransferredFile(value.url)
		} importing: { received in
			try copyReceivedFile(received.file, type: .movie)
		}
		FileRepresentation(contentType: .image) { value in
			SentTransferredFile(value.url)
		} importing: { received in
			try copyReceivedFile(received.file, type: .image)
		}
	}

	private static func copyReceivedFile(_ source: URL, type: UTType) throws -> PickedFile {
		let root = FileManager.default.temporaryDirectory
			.appendingPathComponent("OpenScreenPhotosPicker", isDirectory: true)
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
		let sourceExtension = source.pathExtension
		let fileExtension = sourceExtension.isEmpty ? (type.preferredFilenameExtension ?? "media") : sourceExtension
		let target = root.appendingPathComponent("Photos-\(UUID().uuidString).\(fileExtension)")
		try FileManager.default.copyItem(at: source, to: target)
		return PickedFile(url: target, contentType: type)
	}
}

private struct PickerResponse: Encodable {
	let success: Bool
	let cancelled: Bool
	let paths: [String]
	let errors: [String]
}

@MainActor
private final class PickerCoordinator: ObservableObject {
	@Published var selection: [PhotosPickerItem] = []
	@Published var importing = false
	@Published var progress = "Choose videos or photos from your library."

	func cancel() {
		finish(PickerResponse(success: false, cancelled: true, paths: [], errors: []))
	}

	func importSelection() {
		guard !selection.isEmpty, !importing else { return }
		importing = true
		Task {
			var paths: [String] = []
			var errors: [String] = []
			for (index, item) in selection.enumerated() {
				progress = "Preparing item \(index + 1) of \(selection.count)…"
				do {
					if let file = try await item.loadTransferable(type: PickedFile.self) {
						paths.append(file.url.path)
					} else {
						errors.append("Photos could not provide item \(index + 1).")
					}
				} catch {
					errors.append(error.localizedDescription)
				}
			}
			finish(PickerResponse(success: !paths.isEmpty, cancelled: false, paths: paths, errors: errors))
		}
	}

	private func finish(_ response: PickerResponse) {
		do {
			let data = try JSONEncoder().encode(response)
			FileHandle.standardOutput.write(data)
			FileHandle.standardOutput.write(Data([0x0A]))
		} catch {
			FileHandle.standardError.write(Data(error.localizedDescription.utf8))
		}
		fflush(stdout)
		NSApplication.shared.terminate(nil)
	}
}

private struct PhotosPickerView: View {
	@ObservedObject var coordinator: PickerCoordinator

	var body: some View {
		let selectedCount = coordinator.selection.count
		VStack(alignment: .leading, spacing: 18) {
			Text("Import from Photos")
				.font(.title2.bold())
			Text("OpenScreen receives only the items you select. Nothing is uploaded.")
				.foregroundStyle(.secondary)
			PhotosPicker(
				selection: $coordinator.selection,
				maxSelectionCount: 100,
				matching: .any(of: [.videos, .images]),
				preferredItemEncoding: .current
			) {
				Label(
					selectedCount == 0
						? "Choose Videos or Photos…"
						: "\(selectedCount) item(s) selected — Choose More…",
					systemImage: "photo.on.rectangle.angled"
				)
				.frame(maxWidth: .infinity)
			}
			.buttonStyle(.borderedProminent)
			.controlSize(.large)
			Text(coordinator.progress)
				.font(.callout)
				.foregroundStyle(.secondary)
			HStack {
				Button("Cancel") { coordinator.cancel() }
				Spacer()
				if coordinator.importing { ProgressView().controlSize(.small) }
				Button("Import Selected") { coordinator.importSelection() }
					.buttonStyle(.borderedProminent)
					.disabled(coordinator.selection.isEmpty || coordinator.importing)
			}
		}
		.padding(24)
		.frame(width: 520)
	}
}

@main
private struct OpenScreenPhotosPickerApp: App {
	@StateObject private var coordinator = PickerCoordinator()

	var body: some Scene {
		WindowGroup("Open Screen — Photos") {
			PhotosPickerView(coordinator: coordinator)
		}
		.windowResizability(.contentSize)
		.defaultPosition(.center)
	}
}
