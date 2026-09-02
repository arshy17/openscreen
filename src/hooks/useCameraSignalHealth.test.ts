import { describe, expect, it } from "vitest";
import { cameraPixelsHaveVisibleSignal } from "./useCameraSignalHealth";

describe("cameraPixelsHaveVisibleSignal", () => {
	it("rejects Chromium-style opaque black frames", () => {
		const pixels = new Uint8ClampedArray(24 * 18 * 4);
		for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
		expect(cameraPixelsHaveVisibleSignal(pixels)).toBe(false);
	});

	it("accepts a dim but real image", () => {
		const pixels = new Uint8ClampedArray(100 * 4);
		for (let index = 0; index < 100; index++) {
			const offset = index * 4;
			pixels[offset + 3] = 255;
			if (index < 2) {
				pixels[offset] = 9;
				pixels[offset + 1] = 6;
				pixels[offset + 2] = 5;
			}
		}
		expect(cameraPixelsHaveVisibleSignal(pixels)).toBe(true);
	});

	it("does not treat transparent pixels as a camera image", () => {
		expect(cameraPixelsHaveVisibleSignal(new Uint8ClampedArray([255, 255, 255, 0]))).toBe(false);
	});
});
