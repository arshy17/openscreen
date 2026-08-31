import { describe, expect, it } from "vitest";

import { webDemuxerWasmUrl } from "./extractMono16kWebDemuxer";

describe("webDemuxerWasmUrl", () => {
	it("keeps the packaged caption demuxer inside dist/wasm", () => {
		expect(
			webDemuxerWasmUrl(
				"file:///Applications/OpenScreen%20Preview.app/Contents/Resources/app.asar/dist/index.html?windowType=editor",
			),
		).toBe(
			"file:///Applications/OpenScreen%20Preview.app/Contents/Resources/app.asar/dist/wasm/web-demuxer.wasm",
		);
	});

	it("resolves the same asset from the development page", () => {
		expect(webDemuxerWasmUrl("http://localhost:5173/index.html?windowType=editor")).toBe(
			"http://localhost:5173/wasm/web-demuxer.wasm",
		);
	});
});
