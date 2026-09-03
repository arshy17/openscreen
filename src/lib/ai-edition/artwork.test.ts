import { describe, expect, it } from "vitest";
import {
	ARTWORK_PRESETS,
	applyArtworkSuggestion,
	artworkTextWarnings,
	buildOpeningCardVariantDocument,
	createArtworkDesign,
	replaceArtworkDesign,
	updateArtworkDesign,
} from "./artwork";
import { createEmptyDocument } from "./schema";

describe("Artwork Studio document operations", () => {
	it("keeps the versioned platform registry at exact requested dimensions", () => {
		expect(ARTWORK_PRESETS.map(({ id, width, height }) => [id, width, height])).toEqual([
			["youtube-thumbnail", 3840, 2160],
			["youtube-thumbnail-compat", 1280, 720],
			["reels-cover", 1080, 1920],
			["tiktok-cover", 1080, 1920],
			["shorts-cover", 1080, 1920],
			["instagram-portrait", 1080, 1350],
			["square-cover", 1080, 1080],
			["podcast-cover", 3000, 3000],
			["wide-social", 1200, 628],
		]);
		expect(
			ARTWORK_PRESETS.every((preset) =>
				Object.values(preset.safeArea).every((value) => value >= 0 && value < 0.5),
			),
		).toBe(true);
	});

	it("adds and revises artwork without changing video assets or timeline", () => {
		const original = createEmptyDocument({ projectId: "p", title: "A strong title" });
		const design = createArtworkDesign("reels-cover", original.project.title);
		const next = replaceArtworkDesign(original, design);
		expect(next.assets).toBe(original.assets);
		expect(next.timeline).toBe(original.timeline);
		expect(next.artworkDesigns).toHaveLength(1);
		const edited = updateArtworkDesign(design, { name: "Version B" }, "Rename");
		expect(edited.revision).toBe(1);
		expect(edited.revisions[0].label).toBe("Rename");
	});

	it("applies one schema-shaped suggestion and reports overflow", () => {
		const design = createArtworkDesign("youtube-thumbnail", "A title");
		const changed = applyArtworkSuggestion(design, {
			id: "v1",
			headline: "A much clearer local headline",
			layout: "centered",
			accentColor: "#2563eb",
			evidence: "Project title",
			confidence: 0.8,
		});
		expect(
			changed.layers.some((layer) => layer.type === "text" && layer.text.includes("clearer")),
		).toBe(true);
		const text = changed.layers.find((layer) => layer.type === "text");
		expect(text).toBeTruthy();
		const warned = {
			...changed,
			layers: changed.layers.map((layer) =>
				layer.type === "text" ? { ...layer, text: "word ".repeat(500), height: 20 } : layer,
			),
		};
		expect(artworkTextWarnings(warned)).toContain("AI headline may overflow its text box.");
	});

	it("builds an opening-card variant without mutating the source project", () => {
		const source = createEmptyDocument({ projectId: "source", title: "Original" });
		const video = {
			id: "asset-video",
			kind: "video" as const,
			label: "Original.mov",
			originalPath: "/tmp/original.mov",
			cameraTrack: null,
		};
		const withVideo = {
			...source,
			assets: [video],
			project: { ...source.project, primaryAssetId: video.id },
			timeline: {
				...source.timeline,
				clips: [
					{
						id: "clip-video",
						assetId: video.id,
						sourceStartSec: 0,
						sourceEndSec: 10,
						timelineStartSec: 0,
						timelineEndSec: 10,
						wordRefs: [],
						origin: "user" as const,
						reason: "Original",
					},
				],
				muteRanges: [{ startSec: 1, endSec: 2, reason: "mute" }],
			},
		};
		const card = {
			id: "asset-card",
			kind: "video" as const,
			label: "Opening card",
			originalPath: "/tmp/card.mp4",
			durationSec: 2,
			cameraTrack: null,
		};
		const variant = buildOpeningCardVariantDocument(
			withVideo,
			{ ...withVideo.project, id: "variant", title: "With opening card" },
			card,
			2,
			"artwork-1",
		);
		expect(variant.project.id).toBe("variant");
		expect(variant.timeline.clips.map((clip) => [clip.assetId, clip.timelineStartSec])).toEqual([
			["asset-card", 0],
			["asset-video", 2],
		]);
		expect(variant.timeline.muteRanges[0]).toMatchObject({ startSec: 3, endSec: 4 });
		expect(withVideo.timeline.clips[0].timelineStartSec).toBe(0);
		expect(source.assets).toHaveLength(0);
	});
});
