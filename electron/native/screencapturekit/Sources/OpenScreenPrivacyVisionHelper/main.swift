import AVFoundation
import Foundation
import Vision

private struct ScanRequest: Decodable {
	let videoPath: String
	let sampleIntervalSec: Double?
	let maxSamples: Int?
	let includeFaces: Bool?
	let includeText: Bool?
}

private struct NormalizedBox: Codable {
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

private struct CandidateKeyframe: Codable {
	let timeSec: Double
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

private struct Candidate: Codable {
	let id: String
	let kind: String
	let label: String
	let confidence: Double
	let startSec: Double
	let endSec: Double
	let previewText: String?
	let keyframes: [CandidateKeyframe]
}

private struct ScanResult: Codable {
	let success: Bool
	let durationSec: Double
	let sampledFrames: Int
	let candidates: [Candidate]
}

private struct FrameObservation {
	let kind: String
	let label: String
	let confidence: Double
	let previewText: String?
	let box: NormalizedBox
}

private struct WorkingTrack {
	let id: String
	let kind: String
	let label: String
	var confidence: Double
	var previewText: String?
	var lastTimeSec: Double
	var keyframes: [CandidateKeyframe]
}

private enum ScanFailure: Error, LocalizedError {
	case invalidArguments
	case invalidDuration
	case unreadableVideo

	var errorDescription: String? {
		switch self {
		case .invalidArguments: return "Expected one JSON privacy-scan request."
		case .invalidDuration: return "The selected video has no readable duration."
		case .unreadableVideo: return "The selected video could not be decoded for privacy review."
		}
	}
}

private func clamp(_ value: Double, _ lower: Double = 0, _ upper: Double = 100) -> Double {
	min(upper, max(lower, value))
}

private func normalizedBox(_ rect: CGRect) -> NormalizedBox {
	let width = clamp(rect.width * 100)
	let height = clamp(rect.height * 100)
	return NormalizedBox(
		x: clamp(rect.minX * 100, 0, 100 - width),
		y: clamp((1 - rect.maxY) * 100, 0, 100 - height),
		width: width,
		height: height
	)
}

private func centerDistance(_ left: NormalizedBox, _ right: NormalizedBox) -> Double {
	let dx = left.x + left.width / 2 - right.x - right.width / 2
	let dy = left.y + left.height / 2 - right.y - right.height / 2
	return (dx * dx + dy * dy).squareRoot()
}

private func intersectionOverUnion(_ left: NormalizedBox, _ right: NormalizedBox) -> Double {
	let x1 = max(left.x, right.x)
	let y1 = max(left.y, right.y)
	let x2 = min(left.x + left.width, right.x + right.width)
	let y2 = min(left.y + left.height, right.y + right.height)
	let intersection = max(0, x2 - x1) * max(0, y2 - y1)
	let union = left.width * left.height + right.width * right.height - intersection
	return union > 0 ? intersection / union : 0
}

private func textKind(_ text: String) -> (String, String) {
	let lowered = text.lowercased()
	if text.range(of: #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#, options: [.regularExpression, .caseInsensitive]) != nil {
		return ("email", "Possible email address")
	}
	if text.range(of: #"(?:\+?\d[\d\s().-]{7,}\d)"#, options: .regularExpression) != nil {
		return ("phone", "Possible phone number")
	}
	if ["api key", "apikey", "password", "secret", "access token", "private key", "credential"].contains(where: lowered.contains) {
		return ("credential", "Possible credential")
	}
	let compact = text.replacingOccurrences(of: #"[^A-Z0-9]"#, with: "", options: [.regularExpression, .caseInsensitive])
	let hasLetter = compact.rangeOfCharacter(from: .letters) != nil
	let hasDigit = compact.rangeOfCharacter(from: .decimalDigits) != nil
	if compact.count >= 5 && compact.count <= 10 && hasLetter && hasDigit {
		return ("plate", "Possible identifier or plate")
	}
	return ("text", "On-screen text")
}

private func observations(in image: CGImage, includeFaces: Bool, includeText: Bool) throws -> [FrameObservation] {
	let faceRequest = VNDetectFaceRectanglesRequest()
	let textRequest = VNRecognizeTextRequest()
	textRequest.recognitionLevel = .accurate
	textRequest.usesLanguageCorrection = true
	let requests: [VNRequest] = (includeFaces ? [faceRequest] : []) + (includeText ? [textRequest] : [])
	try VNImageRequestHandler(cgImage: image, options: [:]).perform(requests)

	var found: [FrameObservation] = []
	if includeFaces {
		for face in faceRequest.results ?? [] {
			found.append(FrameObservation(
				kind: "face",
				label: "Face",
				confidence: Double(face.confidence),
				previewText: nil,
				box: normalizedBox(face.boundingBox)
			))
		}
	}
	if includeText {
		for observation in textRequest.results ?? [] {
			guard let recognized = observation.topCandidates(1).first else { continue }
			let text = recognized.string.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !text.isEmpty else { continue }
			let (kind, label) = textKind(text)
			found.append(FrameObservation(
				kind: kind,
				label: label,
				confidence: Double(recognized.confidence),
				previewText: String(text.prefix(120)),
				box: normalizedBox(observation.boundingBox)
			))
		}
	}
	return found
}

private func scan(_ request: ScanRequest) async throws -> ScanResult {
	let url = URL(fileURLWithPath: request.videoPath)
	guard FileManager.default.isReadableFile(atPath: url.path) else { throw ScanFailure.unreadableVideo }
	let asset = AVURLAsset(url: url)
	let durationSec = CMTimeGetSeconds(try await asset.load(.duration))
	guard durationSec.isFinite, durationSec > 0 else { throw ScanFailure.invalidDuration }
	let maxSamples = min(600, max(1, request.maxSamples ?? 240))
	let requestedInterval = min(30, max(0.25, request.sampleIntervalSec ?? 1))
	let coveringInterval = durationSec / Double(max(1, maxSamples - 1))
	let interval = max(requestedInterval, coveringInterval)
	let generator = AVAssetImageGenerator(asset: asset)
	generator.appliesPreferredTrackTransform = true
	generator.requestedTimeToleranceBefore = CMTime(seconds: 0.08, preferredTimescale: 600)
	generator.requestedTimeToleranceAfter = CMTime(seconds: 0.08, preferredTimescale: 600)

	var tracks: [WorkingTrack] = []
	var sampledFrames = 0
	var timeSec = 0.0
	while timeSec <= durationSec + 0.001 && sampledFrames < maxSamples {
		do {
			let image = try generator.copyCGImage(
				at: CMTime(seconds: min(timeSec, durationSec), preferredTimescale: 600),
				actualTime: nil
			)
			let frameObservations = try observations(
				in: image,
				includeFaces: request.includeFaces ?? true,
				includeText: request.includeText ?? true
			)
			var usedTracks = Set<Int>()
			for observation in frameObservations {
				let candidates = tracks.indices.filter { index in
					guard !usedTracks.contains(index), tracks[index].kind == observation.kind else { return false }
					guard timeSec - tracks[index].lastTimeSec <= max(3, interval * 2.5) else { return false }
					let last = tracks[index].keyframes.last!
					let lastBox = NormalizedBox(x: last.x, y: last.y, width: last.width, height: last.height)
					let textMatches = observation.kind == "face" || tracks[index].previewText == observation.previewText
					return textMatches && (intersectionOverUnion(lastBox, observation.box) >= 0.08 || centerDistance(lastBox, observation.box) <= 18)
				}
				let match = candidates.min { left, right in
					let leftKey = tracks[left].keyframes.last!
					let rightKey = tracks[right].keyframes.last!
					return centerDistance(
						NormalizedBox(x: leftKey.x, y: leftKey.y, width: leftKey.width, height: leftKey.height),
						observation.box
					) < centerDistance(
						NormalizedBox(x: rightKey.x, y: rightKey.y, width: rightKey.width, height: rightKey.height),
						observation.box
					)
				}
				let keyframe = CandidateKeyframe(
					timeSec: min(timeSec, durationSec),
					x: observation.box.x,
					y: observation.box.y,
					width: observation.box.width,
					height: observation.box.height
				)
				if let index = match {
					usedTracks.insert(index)
					tracks[index].confidence = max(tracks[index].confidence, observation.confidence)
					tracks[index].lastTimeSec = timeSec
					tracks[index].keyframes.append(keyframe)
				} else {
					tracks.append(WorkingTrack(
						id: UUID().uuidString,
						kind: observation.kind,
						label: observation.label,
						confidence: observation.confidence,
						previewText: observation.previewText,
						lastTimeSec: timeSec,
						keyframes: [keyframe]
					))
					usedTracks.insert(tracks.count - 1)
				}
			}
			sampledFrames += 1
		} catch {
			// A single undecodable frame does not invalidate the whole review. Continue
			// across the source and fail only if no frame could be sampled at all.
		}
		timeSec += interval
	}
	guard sampledFrames > 0 else { throw ScanFailure.unreadableVideo }
	let candidates = tracks
		.filter { !$0.keyframes.isEmpty }
		.map { track in
			Candidate(
				id: track.id,
				kind: track.kind,
				label: track.label,
				confidence: track.confidence,
				startSec: track.keyframes.first!.timeSec,
				endSec: min(durationSec, track.keyframes.last!.timeSec + interval),
				previewText: track.previewText,
				keyframes: track.keyframes
			)
		}
		.sorted { left, right in
			if left.startSec == right.startSec { return left.confidence > right.confidence }
			return left.startSec < right.startSec
		}
	return ScanResult(success: true, durationSec: durationSec, sampledFrames: sampledFrames, candidates: candidates)
}

@main
private struct OpenScreenPrivacyVisionHelper {
	static func main() async {
		do {
			guard CommandLine.arguments.count == 2,
				let data = CommandLine.arguments[1].data(using: .utf8)
			else { throw ScanFailure.invalidArguments }
			let request = try JSONDecoder().decode(ScanRequest.self, from: data)
			let result = try await scan(request)
			let encoder = JSONEncoder()
			encoder.outputFormatting = [.sortedKeys]
			FileHandle.standardOutput.write(try encoder.encode(result))
			FileHandle.standardOutput.write(Data("\n".utf8))
		} catch {
			let message = error.localizedDescription.replacingOccurrences(of: "\"", with: "'")
			FileHandle.standardError.write(Data("Privacy Vision scan failed: \(message)\n".utf8))
			exit(1)
		}
	}
}
