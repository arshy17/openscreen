import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
	applyTrackedPrivacyMask,
	assessProjectPerformance,
	buildCreatorEditPlan,
} from "./creatorToolkit";
import { type AxcutDocument, createEmptyDocument, documentSchema } from "./schema";

function longProject(): AxcutDocument {
	const base = createEmptyDocument({ projectId: "perf", title: "Two hour fixture" });
	const segments = Array.from({ length: 3_600 }, (_, index) => ({
		id: `segment_${index}`,
		kind: index % 4 === 3 ? ("silence" as const) : ("speech" as const),
		startSec: index * 2,
		endSec: index * 2 + (index % 4 === 3 ? 1.6 : 1.8),
		text: index % 4 === 3 ? "" : `Sentence ${index}`,
		wordIds: [],
	}));
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_perf" },
		assets: [
			{
				id: "asset_perf",
				kind: "video",
				label: "long.mp4",
				originalPath: "/tmp/long.mp4",
				durationSec: 7_200,
				cameraTrack: null,
			},
		],
		transcripts: [{ assetId: "asset_perf", language: "en", segments, words: [] }],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_perf",
					assetId: "asset_perf",
					sourceStartSec: 0,
					sourceEndSec: 7_200,
					timelineStartSec: 0,
					timelineEndSec: 7_200,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

describe("reliability performance budget", () => {
	it("keeps a two-hour, 3,600-segment planning pass bounded", () => {
		const document = longProject();
		const started = performance.now();
		const plan = buildCreatorEditPlan(document, "youtube-explainer", 1);
		const assessment = assessProjectPerformance(document);
		const tracked = applyTrackedPrivacyMask(document, {
			startSec: 0,
			endSec: 300,
			from: "top-left",
			to: "bottom-right",
		});
		const elapsedMs = performance.now() - started;

		expect(plan.trimSuggestions.length).toBeLessThanOrEqual(8);
		expect(assessment.level).not.toBe("healthy");
		expect(tracked.annotations).toHaveLength(48);
		// Wide enough for busy shared CI, tight enough to catch an accidental
		// quadratic renderer-side scan before it ships.
		expect(elapsedMs).toBeLessThan(1_500);
	});
});
