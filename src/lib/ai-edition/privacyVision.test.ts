import { describe, expect, it } from "vitest";
import { applyVisionPrivacyCandidates, type PrivacyVisionCandidate } from "./privacyVision";
import { createEmptyDocument, documentSchema } from "./schema";

function fixture() {
	const base = createEmptyDocument({
		projectId: "privacy_test",
		title: "Privacy test",
		createdAt: "2026-09-02T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "source.mp4",
				originalPath: "/tmp/source.mp4",
				durationSec: 20,
				cameraTrack: null,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 5,
					sourceEndSec: 15,
					timelineStartSec: 0,
					timelineEndSec: 10,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

const candidate: PrivacyVisionCandidate = {
	id: "candidate_1",
	kind: "email",
	label: "Possible email address",
	confidence: 0.94,
	startSec: 4,
	endSec: 8,
	previewText: "person@example.com",
	keyframes: [
		{ timeSec: 4, x: 1, y: 2, width: 20, height: 5 },
		{ timeSec: 6, x: 4, y: 5, width: 20, height: 5 },
	],
};

describe("Vision privacy candidate application", () => {
	it("does not change a document until selected candidates are applied", () => {
		const source = fixture();
		expect(applyVisionPrivacyCandidates(source, "asset_1", [])).toBe(source);
		expect(source.annotations).toEqual([]);
	});

	it("clips source-time candidates and creates editable anchored mask keyframes", () => {
		const source = fixture();
		const next = applyVisionPrivacyCandidates(source, "asset_1", [candidate]);
		expect(next.annotations).toHaveLength(2);
		expect(next.annotations[0]).toMatchObject({
			type: "blur",
			clipId: "clip_1",
			sourceStartSec: 5,
			sourceEndSec: 6,
			startMs: 0,
			endMs: 1000,
			position: { x: 0, y: 0.5 },
		});
		expect(next.annotations[1]).toMatchObject({
			sourceStartSec: 6,
			sourceEndSec: 8,
			startMs: 1000,
			endMs: 3000,
		});
		expect(source.annotations).toEqual([]);
	});
});
