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
					{
						id: "w3",
						segmentId: "s1",
						startSec: 15,
						endSec: 15.4,
						text: "success",
					},
					{
						id: "w4",
						segmentId: "s1",
						startSec: 29,
						endSec: 29.4,
						text: "why?",
					},
					{
						id: "w5",
						segmentId: "s1",
						startSec: 43,
						endSec: 43.4,
						text: "next",
					},
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
	it("ships previewable Shorts, YouTube, social-feed and professional presets", () => {
		expect(CREATOR_THEMES.map((theme) => theme.id)).toEqual([
			"social-punch",
			"clean-creator",
			"shorts-hook",
			"story-spotlight",
			"tutorial-focus",
			"youtube-explainer",
			"instagram-feed",
			"podcast-pro",
			"minimal-pro",
		]);
		expect(new Set(CREATOR_THEMES.map((theme) => theme.aspectRatio))).toEqual(
			new Set(["9:16", "16:9", "4:5"]),
		);
		expect(new Set(CREATOR_THEMES.map((theme) => theme.category))).toEqual(
			new Set(["Shorts & Reels", "YouTube", "Social feed", "Professional"]),
		);
		expect(CREATOR_THEMES.every((theme) => theme.preview.background && theme.preview.accent)).toBe(
			true,
		);
		expect(
			CREATOR_THEMES.every(
				(theme) =>
					theme.exportSize.width > 0 &&
					theme.exportSize.height > 0 &&
					Object.values(theme.safeArea).every((value) => value >= 0 && value < 50),
			),
		).toBe(true);
		expect(
			CREATOR_THEMES.filter((theme) => theme.aspectRatio === "9:16").map((theme) => theme.platform),
		).toEqual(["Instagram Reels", "TikTok", "YouTube Shorts", "Stories & Spotlight"]);
	});

	it("applies a vertical style and sparse transcript-aware visuals without AI", () => {
		const before = fixture();
		const result = applyCreatorTheme(before, "social-punch");

		expect(getEditorSettings(result.document)).toMatchObject({
			aspectRatio: "9:16",
			padding: 12,
			autoFocusAll: true,
			webcamLayoutPreset: "picture-in-picture",
			webcamSizePreset: 20,
			webcamPosition: { cx: 0.23, cy: 0.2 },
		});
		expect(getCaptionSettings(result.document, 9 / 16)).toMatchObject({
			enabled: true,
			fontSize: 46,
			maxWordsPerLine: 5,
			insetY: 18,
			insetX: 7,
		});
		// "done" is too close to "idea", and "success" is inside a trim.
		expect(result.visualsAdded).toBe(3);
		expect(result.document.annotations.map((annotation) => annotation.content)).toEqual([
			"💡 TIP",
			"? WHY?",
			"→ NEXT",
		]);
		expect(result.document.annotations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					position: expect.objectContaining({
						x: expect.any(Number),
						y: expect.any(Number),
					}),
					size: { width: 27, height: 7 },
					style: expect.objectContaining({ fontSize: 38, fontFamily: "Inter" }),
				}),
			]),
		);
		expect(
			result.document.annotations.every(
				(annotation) =>
					annotation.position.x >= 7 && annotation.position.x + annotation.size.width <= 84,
			),
		).toBe(true);
		expect(result.document.annotations.every((annotation) => annotation.clipId === "clip_1")).toBe(
			true,
		);
		expect(result.document.timeline.clips).toEqual(before.timeline.clips);
		expect(result.document.timeline.trimRanges).toEqual(before.timeline.trimRanges);
		expect(() => documentSchema.parse(result.document)).not.toThrow();
	});

	it("overrides an old landscape caption inset when applying a platform-safe vertical theme", () => {
		const before = fixture();
		const withLandscapeCaptions: AxcutDocument = {
			...before,
			legacyEditor: {
				...before.legacyEditor,
				captions: {
					...getCaptionSettings(before, 16 / 9),
					enabled: true,
					insetY: 1.5,
				},
			},
		};

		const reels = applyCreatorTheme(withLandscapeCaptions, "social-punch");
		const tiktok = applyCreatorTheme(withLandscapeCaptions, "clean-creator");
		const shorts = applyCreatorTheme(withLandscapeCaptions, "shorts-hook");

		expect(getCaptionSettings(reels.document, 9 / 16).insetY).toBe(18);
		expect(getCaptionSettings(tiktok.document, 9 / 16).insetY).toBe(20);
		expect(getCaptionSettings(shorts.document, 9 / 16).insetY).toBe(16);
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

	it("uses a bundled animated reaction for energetic celebration words", () => {
		const before = fixture();
		before.transcripts[0].words[3] = {
			...before.transcripts[0].words[3],
			text: "great",
		};
		const result = applyCreatorTheme(before, "social-punch");
		const sticker = result.document.annotations.find((annotation) => annotation.type === "image");
		expect(sticker).toMatchObject({
			type: "image",
			size: { width: 13, height: 8 },
		});
		expect(sticker?.content.startsWith("data:image/gif;base64,R0lGOD")).toBe(true);
	});

	it("applies a distinct YouTube composition including its export background", () => {
		const result = applyCreatorTheme(fixture(), "youtube-explainer");
		const editor = getEditorSettings(result.document);
		expect(editor).toMatchObject({
			aspectRatio: "16:9",
			webcamMaskShape: "circle",
			webcamSizePreset: 28,
		});
		expect(editor.wallpaper).toContain("linear-gradient");
	});

	it("builds a local-provider-compatible prompt with safety and restraint", () => {
		const prompt = buildCreatorEditPrompt("social-punch");
		expect(prompt).toContain("already applied the 9:16 composition");
		expect(prompt).toContain("do not call setOutputFormat or setCaptions");
		expect(prompt).toContain("no more than five high-confidence cuts");
		expect(prompt).toContain("preloaded one bounded current-document snapshot");
		expect(prompt).toContain("Preserve the existing zooms");
		expect(prompt).toContain("Do not export or publish");
		expect(prompt).not.toContain("OpenAI");
	});
});
