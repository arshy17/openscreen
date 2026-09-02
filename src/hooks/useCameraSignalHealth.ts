import { useEffect, useState } from "react";

export type CameraSignalStatus = "disabled" | "checking" | "live" | "black" | "stalled";

export interface CameraSignalHealth {
	status: CameraSignalStatus;
	message: string;
}

const DISABLED: CameraSignalHealth = {
	status: "disabled",
	message: "Camera is off by choice",
};

const CHECKING: CameraSignalHealth = {
	status: "checking",
	message: "Waiting for a real camera frame…",
};

/**
 * Browser camera APIs can resolve successfully while macOS delivers an opaque
 * stream of zeroed frames. A non-null MediaStream therefore is not proof that
 * the user can see themselves or that MediaRecorder will save a useful track.
 *
 * Keep the threshold deliberately close to true black. This is a health gate,
 * not exposure grading: a dim but real room should pass, while Chromium's
 * all-zero failure frames (and a physically covered lens) should not.
 */
export function cameraPixelsHaveVisibleSignal(pixels: Uint8ClampedArray): boolean {
	let visiblePixels = 0;
	let sampledPixels = 0;
	for (let index = 0; index + 3 < pixels.length; index += 4) {
		const alpha = pixels[index + 3] ?? 0;
		if (alpha === 0) continue;
		sampledPixels++;
		const red = pixels[index] ?? 0;
		const green = pixels[index + 1] ?? 0;
		const blue = pixels[index + 2] ?? 0;
		if (Math.max(red, green, blue) >= 8 || red + green + blue >= 15) {
			visiblePixels++;
		}
	}
	return sampledPixels > 0 && visiblePixels / sampledPixels >= 0.01;
}

function readFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): "live" | "black" | null {
	if (
		video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
		!video.videoWidth ||
		!video.videoHeight
	) {
		return null;
	}
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return null;
	try {
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		return cameraPixelsHaveVisibleSignal(pixels) ? "live" : "black";
	} catch {
		return null;
	}
}

/**
 * Continuously proves that a getUserMedia stream is producing visible pixels.
 * The probe owns only its muted video element; it never stops or clones the
 * caller's track, so the exact same stream remains the self-view and recorder
 * source.
 */
export function useCameraSignalHealth(
	stream: MediaStream | null,
	enabled = Boolean(stream),
): CameraSignalHealth {
	const [health, setHealth] = useState<CameraSignalHealth>(enabled ? CHECKING : DISABLED);

	useEffect(() => {
		if (!enabled || !stream) {
			setHealth(DISABLED);
			return;
		}

		let cancelled = false;
		let samples = 0;
		let consecutiveBlackSamples = 0;
		const startedAt = performance.now();
		const video = document.createElement("video");
		const canvas = document.createElement("canvas");
		canvas.width = 24;
		canvas.height = 18;
		video.autoplay = true;
		video.muted = true;
		video.playsInline = true;
		video.srcObject = stream;
		setHealth(CHECKING);
		const isJsdom = navigator.userAgent.includes("jsdom");
		if (!isJsdom) {
			void video.play().catch(() => {
				// A muted getUserMedia stream normally bypasses autoplay policy. If it
				// does not, the timed stalled result below is the truthful outcome.
			});
		}

		const inspect = () => {
			if (cancelled) return;
			const track = stream.getVideoTracks?.()[0];
			if (!track || track.readyState === "ended") {
				setHealth({ status: "stalled", message: "Camera stopped delivering frames" });
				return;
			}

			const result = readFrame(video, canvas);
			if (result) {
				samples++;
				if (result === "live") {
					consecutiveBlackSamples = 0;
					setHealth({ status: "live", message: "Visible camera frames detected" });
				} else {
					consecutiveBlackSamples++;
					if (consecutiveBlackSamples >= 3) {
						setHealth({
							status: "black",
							message: "Camera opened but is returning black frames",
						});
					}
				}
			} else if (samples === 0 && performance.now() - startedAt >= 5_000) {
				setHealth({ status: "stalled", message: "Camera opened but no frames arrived" });
			}
		};

		inspect();
		const interval = window.setInterval(inspect, 350);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
			if (!isJsdom) video.pause();
			video.srcObject = null;
		};
	}, [enabled, stream]);

	return health;
}
