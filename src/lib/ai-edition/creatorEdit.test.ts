import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "./captions";
import { applyCreatorTheme, buildCreatorEditPrompt, CREATOR_THEMES } from "./creatorEdit";
import { type AxcutDocument, createEmptyDocument, documentSchema } from "./schema";
import { getEditorSettings } from "./store/editorSettings";

function fixture(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "creator_edit",
		title: "Creator edit",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "recording.mp4",
				originalPath: "/tmp/recording.mp4",
				durationSec: 50,
				cameraTrack: null,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [],
				words: [
					{ id: "w1", segmentId: "s1", startSec: 1, endSec: 1.4, text: "idea" },
					{ id: "w2", segmentId: "s1", startSec: 4, endSec: 4.4, text: "done" },
					{ id: "w3", segmentId: "s1", startSec: 15, endSec: 15.4, text: "success" },
					{ id: "w4", segmentId: "s1", startSec: 29, endSec: 29.4, text: "why?" },
					{ id: "w5", segmentId: "s1", startSec: 43, endSec: 43.4, text: "next" },
				],
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 50,
					timelineStartSec: 0,
					timelineEndSec: 50,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [
				{
					id: "trim_1",
					assetId: "asset_1",
					clipId: "clip_1",
					startSec: 14,
					endSec: 16,
					reason: "manual",
					origin: "user",
				},
			],
		},
	});
}

describe("creator edit themes", () => {
	it("ships distinct social, tutorial and professional presets", () => {
		expect(CREATOR_THEMES.map((theme) => theme.id)).toEqual([
			"social-punch",
			"clean-creator",
			"tutorial-focus",
			"minimal-pro",
		]);
		expect(new Set(CREATOR_THEMES.map((theme) => theme.aspectRatio))).toEqual(
			new Set(["9:16", "16:9", "4:5"]),
		);
	});

	it("applies a vertical style and sparse transcript-aware visuals without AI", () => {
		const before = fixture();
		const result = applyCreatorTheme(before, "social-punch");

		expect(getEditorSettings(result.document).aspectRatio).toBe("9:16");
		expect(getCaptionSettings(result.document, 9 / 16)).toMatchObject({
			enabled: true,
			fontSize: 58,
			maxWordsPerLine: 5,
			insetY: 12.5,
		});
		// "done" is too close to "idea", and "success" is inside a trim.
		expect(result.visualsAdded).toBe(3);
		expect(result.document.annotations.map((annotation) => annotation.content)).toEqual([
			"💡",
			"?",
			"→",
		]);
		expect(result.document.annotations.every((annotation) => annotation.clipId === "clip_1")).toBe(
			true,
		);
		expect(result.document.timeline.clips).toEqual(before.timeline.clips);
		expect(result.document.timeline.trimRanges).toEqual(before.timeline.trimRanges);
		expect(() => documentSchema.parse(result.document)).not.toThrow();
	});

	it("keeps the minimal theme free of decorative visual additions", () => {
		const result = applyCreatorTheme(fixture(), "minimal-pro");
		expect(getEditorSettings(result.document).aspectRatio).toBe("4:5");
		expect(result.visualsAdded).toBe(0);
		expect(result.document.annotations).toEqual([]);
		expect(getCaptionSettings(result.document, 4 / 5)).toMatchObject({
			enabled: true,
			backgroundEnabled: false,
		});
	});

	it("builds a local-provider-compatible prompt with safety and restraint", () => {
		const prompt = buildCreatorEditPrompt("social-punch");
		expect(prompt).toContain("Set the output format to 9:16");
		expect(prompt).toContain("no more than one relevant visual callout per 10 seconds");
		expect(prompt).toContain("read cursor telemetry before adding zooms");
		expect(prompt).toContain("Do not export or publish");
		expect(prompt).not.toContain("OpenAI");
	});
});
