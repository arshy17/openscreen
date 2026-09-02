import Foundation

/// The stable identity ScreenCaptureKit expects for `microphoneCaptureDeviceID`,
/// paired with the labels AVFoundation exposes for matching.
public struct MicrophoneCaptureDevice: Equatable, Sendable {
	public let uniqueID: String
	public let localizedName: String
	public let modelID: String

	public init(uniqueID: String, localizedName: String, modelID: String = "") {
		self.uniqueID = uniqueID
		self.localizedName = localizedName
		self.modelID = modelID
	}
}

/// Resolves Chromium's microphone identity to the AVFoundation identity that
/// ScreenCaptureKit requires.
///
/// Chromium device ids are origin-salted and cannot be handed to
/// `SCStreamConfiguration.microphoneCaptureDeviceID`. Its labels also decorate
/// the driver's name, for example `Default - MacBook Pro Microphone (Built-in)`
/// or `Wireless Microphone (3547:0407)`, while AVFoundation reports only
/// `MacBook Pro Microphone` or `Wireless Microphone`. Matching only by equality
/// therefore discarded the user's selection and silently recorded the system
/// default instead.
///
/// The inexact rule is deliberately narrow: one normalized value must contain
/// the other as whole words. A shared brand or substring is not enough to pick
/// a different device.
public func preferredMicrophoneCaptureDevice(
	requestedID: String?,
	requestedName: String?,
	candidates: [MicrophoneCaptureDevice]
) -> MicrophoneCaptureDevice? {
	let requestedID = requestedID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
	if !requestedID.isEmpty,
		let exactID = candidates.first(where: { $0.uniqueID == requestedID })
	{
		return exactID
	}

	let requested = normalizedDeviceName(requestedName ?? "")
	guard !requested.isEmpty else {
		return nil
	}

	var best: (score: Int, device: MicrophoneCaptureDevice)?
	for device in candidates {
		let name = normalizedDeviceName(device.localizedName)
		let model = normalizedDeviceName(device.modelID)
		let score: Int
		if name == requested {
			score = 1_000
		} else if containsWholeWords(name, requested) || containsWholeWords(requested, name) {
			score = 900 + min(name.count, requested.count)
		} else if containsWholeWords(model, requested) || containsWholeWords(requested, model) {
			score = 800 + min(model.count, requested.count)
		} else {
			continue
		}

		if let currentBest = best, score <= currentBest.score {
			continue
		} else {
			best = (score, device)
		}
	}

	return best?.device
}

private func normalizedDeviceName(_ value: String) -> String {
	let words = value.lowercased().unicodeScalars.split { scalar in
		!CharacterSet.alphanumerics.contains(scalar)
	}
	return words.map(String.init).joined(separator: " ")
}

private func containsWholeWords(_ haystack: String, _ needle: String) -> Bool {
	guard !haystack.isEmpty, !needle.isEmpty else {
		return false
	}

	let paddedHaystack = " \(haystack) "
	let paddedNeedle = " \(needle) "
	return paddedHaystack.contains(paddedNeedle)
}
