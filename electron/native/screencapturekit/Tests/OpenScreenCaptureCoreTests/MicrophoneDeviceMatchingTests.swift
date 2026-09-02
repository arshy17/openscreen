import XCTest
@testable import OpenScreenCaptureCore

final class MicrophoneDeviceMatchingTests: XCTestCase {
	private let devices = [
		MicrophoneCaptureDevice(
			uniqueID: "BuiltInMicrophoneDevice",
			localizedName: "MacBook Pro Microphone",
			modelID: "Built-in Microphone"
		),
		MicrophoneCaptureDevice(
			uniqueID: "AppleUSBAudioEngine:Wireless Microphone",
			localizedName: "Wireless Microphone",
			modelID: "Wireless Microphone:3547:0407"
		),
		MicrophoneCaptureDevice(
			uniqueID: "MSLoopbackDriverDevice_UID",
			localizedName: "Microsoft Teams Audio",
			modelID: "Microsoft Teams Audio Device"
		),
	]

	func testUsesExactNativeIdentifierWhenAvailable() {
		let selected = preferredMicrophoneCaptureDevice(
			requestedID: "BuiltInMicrophoneDevice",
			requestedName: "something else",
			candidates: devices
		)
		XCTAssertEqual(selected?.uniqueID, "BuiltInMicrophoneDevice")
	}

	func testMatchesChromiumDefaultLabelToMacBookMicrophone() {
		let selected = preferredMicrophoneCaptureDevice(
			requestedID: "origin-salted-chromium-id",
			requestedName: "Default - MacBook Pro Microphone (Built-in)",
			candidates: devices
		)
		XCTAssertEqual(selected?.uniqueID, "BuiltInMicrophoneDevice")
	}

	func testMatchesChromiumUsbSuffixToWirelessMicrophone() {
		let selected = preferredMicrophoneCaptureDevice(
			requestedID: "another-origin-salted-id",
			requestedName: "Default - Wireless Microphone (3547:0407)",
			candidates: devices
		)
		XCTAssertEqual(selected?.uniqueID, "AppleUSBAudioEngine:Wireless Microphone")
	}

	func testRefusesADeviceThatOnlySharesOneWord() {
		let selected = preferredMicrophoneCaptureDevice(
			requestedID: nil,
			requestedName: "Studio Microphone",
			candidates: devices
		)
		XCTAssertNil(selected)
	}

	func testReturnsNilWithoutAUsableRequestedIdentity() {
		XCTAssertNil(
			preferredMicrophoneCaptureDevice(
				requestedID: "origin-salted-id",
				requestedName: "",
				candidates: devices
			)
		)
	}
}
