import { describe, expect, it } from "vitest";
import { needsEditingProxy, parseFfprobeResult, parseRate } from "./projectMediaImport";

describe("managed iPhone media import", () => {
	it("parses portrait rotation, VFR, HDR, audio tracks and storage metadata", () => {
		const probe = parseFfprobeResult(
			{
				format: { format_name: "mov,mp4", duration: "12.5" },
				streams: [
					{
						codec_type: "video",
						codec_name: "hevc",
						codec_tag_string: "hvc1",
						width: 3840,
						height: 2160,
						r_frame_rate: "60/1",
						avg_frame_rate: "1797/30",
						color_primaries: "bt2020",
						color_transfer: "smpte2084",
						side_data_list: [{ rotation: 90 }],
					},
					{ codec_type: "audio", codec_name: "aac" },
					{ codec_type: "audio", codec_name: "pcm_s16le" },
				],
			},
			1_234_567,
		);
		expect(probe).toMatchObject({
			videoCodec: "hevc",
			width: 3840,
			height: 2160,
			rotationDegrees: 90,
			variableFrameRate: true,
			dynamicRange: "hdr",
			audioTrackCount: 2,
			fileSizeBytes: 1_234_567,
		});
		expect(needsEditingProxy(probe)).toBe(true);
	});

	it("lets inexpensive H.264 Rec.709 footage use its managed original", () => {
		const probe = parseFfprobeResult(
			{
				format: { format_name: "mp4", duration: 3 },
				streams: [
					{
						codec_type: "video",
						codec_name: "h264",
						width: 1920,
						height: 1080,
						r_frame_rate: "30/1",
						avg_frame_rate: "30/1",
						color_primaries: "bt709",
					},
				],
			},
			100,
		);
		expect(needsEditingProxy(probe)).toBe(false);
		expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
		expect(parseRate("0/0")).toBe(0);
	});

	it("recognizes Dolby Vision metadata as an SDR-proxy requirement", () => {
		const probe = parseFfprobeResult(
			{
				format: { duration: "1" },
				streams: [
					{
						codec_type: "video",
						codec_name: "hevc",
						codec_tag_string: "dvhe",
						width: 1080,
						height: 1920,
						r_frame_rate: "30/1",
						avg_frame_rate: "30/1",
					},
				],
			},
			42,
		);
		expect(probe.dynamicRange).toBe("dolby-vision");
		expect(needsEditingProxy(probe)).toBe(true);
	});
});
