import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision

private struct ArtworkVisionRequest: Decodable {
	let operation: String?
	let imagePaths: [String]?
	let imagePath: String?
	let outputPath: String?
}

private struct RankedImage: Codable {
	let path: String
	let sharpness: Double
	let exposure: Double
	let faceVisibility: Double
	let textSpace: Double
	let score: Double
}

private struct RankResult: Codable {
	let success: Bool
	let images: [RankedImage]
}

private struct CutoutResult: Codable {
	let success: Bool
	let outputPath: String
}

private enum RankFailure: Error, LocalizedError {
	case invalidArguments
	case unreadableImage(String)
	case noPerson
	case missingOutput

	var errorDescription: String? {
		switch self {
		case .invalidArguments: return "Expected one JSON frame-ranking request."
		case .unreadableImage(let path): return "Could not read artwork frame at \(path)."
		case .noPerson: return "Apple Vision could not find a person to cut out in this image."
		case .missingOutput: return "The cutout request is missing its output path."
		}
	}
}

private func clamp(_ value: Double) -> Double { min(1, max(0, value)) }

private func readImage(_ path: String) throws -> CGImage {
	let url = URL(fileURLWithPath: path) as CFURL
	guard let source = CGImageSourceCreateWithURL(url, nil),
		let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceThumbnailMaxPixelSize: 640,
			kCGImageSourceCreateThumbnailWithTransform: true,
		] as CFDictionary)
	else { throw RankFailure.unreadableImage(path) }
	return image
}

private func readFullImage(_ path: String) throws -> CGImage {
	let url = URL(fileURLWithPath: path) as CFURL
	guard let source = CGImageSourceCreateWithURL(url, nil),
		let image = CGImageSourceCreateImageAtIndex(source, 0, [
			kCGImageSourceShouldCache: false,
		] as CFDictionary)
	else { throw RankFailure.unreadableImage(path) }
	return image
}

private func cutout(_ inputPath: String, outputPath: String) throws {
	let image = try readFullImage(inputPath)
	let request = VNGeneratePersonSegmentationRequest()
	request.qualityLevel = .accurate
	request.outputPixelFormat = kCVPixelFormatType_OneComponent8
	try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
	guard let maskBuffer = request.results?.first?.pixelBuffer else { throw RankFailure.noPerson }

	let foreground = CIImage(cgImage: image)
	let rawMask = CIImage(cvPixelBuffer: maskBuffer)
	let mask = rawMask.transformed(by: CGAffineTransform(
		scaleX: foreground.extent.width / rawMask.extent.width,
		y: foreground.extent.height / rawMask.extent.height
	))
	let transparent = CIImage(color: .clear).cropped(to: foreground.extent)
	let result = foreground.applyingFilter("CIBlendWithMask", parameters: [
		kCIInputBackgroundImageKey: transparent,
		kCIInputMaskImageKey: mask,
	])
	let url = URL(fileURLWithPath: outputPath)
	try FileManager.default.createDirectory(
		at: url.deletingLastPathComponent(),
		withIntermediateDirectories: true
	)
	let colorSpace = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
	try CIContext(options: [.cacheIntermediates: false]).writePNGRepresentation(
		of: result,
		to: url,
		format: .RGBA8,
		colorSpace: colorSpace
	)
}

private func pixelScores(_ image: CGImage) -> (sharpness: Double, exposure: Double) {
	let width = image.width
	let height = image.height
	var pixels = [UInt8](repeating: 0, count: width * height * 4)
	guard let context = CGContext(
		data: &pixels,
		width: width,
		height: height,
		bitsPerComponent: 8,
		bytesPerRow: width * 4,
		space: CGColorSpaceCreateDeviceRGB(),
		bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
	) else { return (0, 0) }
	context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
	func luminance(_ offset: Int) -> Double {
		(0.2126 * Double(pixels[offset]) + 0.7152 * Double(pixels[offset + 1]) + 0.0722 * Double(pixels[offset + 2])) / 255
	}
	var total = 0.0
	var gradients = 0.0
	var count = 0
	for y in 0..<height {
		for x in 0..<width {
			let offset = (y * width + x) * 4
			let value = luminance(offset)
			total += value
			if x > 0 && y > 0 {
				gradients += abs(value - luminance(offset - 4)) + abs(value - luminance(offset - width * 4))
			}
			count += 1
		}
	}
	let average = count > 0 ? total / Double(count) : 0
	let exposure = clamp(1 - abs(average - 0.52) / 0.52)
	let sharpness = clamp(gradients / Double(max(1, count)) * 7.5)
	return (sharpness, exposure)
}

private func rank(_ path: String) throws -> RankedImage {
	let image = try readImage(path)
	let faceRequest = VNDetectFaceRectanglesRequest()
	let textRequest = VNDetectTextRectanglesRequest()
	try VNImageRequestHandler(cgImage: image, options: [:]).perform([faceRequest, textRequest])
	let faces = faceRequest.results ?? []
	let text = textRequest.results ?? []
	let faceArea = faces.reduce(0.0) { $0 + Double($1.boundingBox.width * $1.boundingBox.height) }
	let occupied = (faces.map(\.boundingBox) + text.map(\.boundingBox)).reduce(0.0) {
		$0 + Double($1.width * $1.height)
	}
	let faceVisibility = faces.isEmpty ? 0.35 : clamp(0.55 + min(faceArea, 0.3) * 1.5)
	let textSpace = clamp(1 - min(0.82, occupied))
	let pixels = pixelScores(image)
	let score = pixels.sharpness * 0.35 + pixels.exposure * 0.25 + faceVisibility * 0.22 + textSpace * 0.18
	return RankedImage(
		path: path,
		sharpness: pixels.sharpness,
		exposure: pixels.exposure,
		faceVisibility: faceVisibility,
		textSpace: textSpace,
		score: clamp(score)
	)
}

do {
	guard CommandLine.arguments.count == 2,
		let data = CommandLine.arguments[1].data(using: .utf8)
	else { throw RankFailure.invalidArguments }
	let request = try JSONDecoder().decode(ArtworkVisionRequest.self, from: data)
	let output: Data
	if request.operation == "cutout" {
		guard let inputPath = request.imagePath else { throw RankFailure.invalidArguments }
		guard let outputPath = request.outputPath else { throw RankFailure.missingOutput }
		try cutout(inputPath, outputPath: outputPath)
		output = try JSONEncoder().encode(CutoutResult(success: true, outputPath: outputPath))
	} else {
		let images = (request.imagePaths ?? []).compactMap { try? rank($0) }.sorted { $0.score > $1.score }
		output = try JSONEncoder().encode(RankResult(success: true, images: images))
	}
	FileHandle.standardOutput.write(output)
} catch {
	let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
	let payload = try JSONSerialization.data(withJSONObject: ["success": false, "error": message])
	FileHandle.standardOutput.write(payload)
	exit(1)
}
