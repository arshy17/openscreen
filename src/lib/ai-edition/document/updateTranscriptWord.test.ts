import { describe, expect, it } from "vitest";
import { getCaptionTranslations, putCaptionTranslation } from "../captions";
import type { AxcutDocument } from "../schema";
import { updateTranscriptWordText } from "./updateTranscriptWord";

function document(): AxcutDocument {
	return {
		schemaVersion: 7,
		project: {
			id: "project_1",
			title: "Transcript edit",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			primaryAssetId: "asset_1",
		},
		assets: [],
		transcript: null,
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "segment_1",
						kind: "speech",
						startSec: 0,
						endSec: 2,
						text: "Welcome home",
						wordIds: ["word_1", "word_2"],
					},
				],
				words: [
					{ id: "word_1", segmentId: "segment_1", startSec: 0, endSec: 1, text: "Welcome" },
					{ id: "word_2", segmentId: "segment_1", startSec: 1, endSec: 2, text: "home" },
				],
			},
		],
		timeline: {
			clips: [],
			gaps: [],
			trimRanges: [],
			muteRanges: [],
			speedRanges: [],
			captionRanges: [],
		},
		annotations: [],
		zoomRanges: [],
		legacyEditor: null,
	};
}

describe("updateTranscriptWordText", () => {
	it("updates the timed word and rebuilds its segment text", () => {
		const next = updateTranscriptWordText(document(), "asset_1", "word_2", "everyone!");
		expect(next.transcripts[0].words[1].text).toBe("everyone!");
		expect(next.transcripts[0].segments[0].text).toBe("Welcome everyone!");
	});

	it("keeps the backward-compatible primary transcript in sync", () => {
		const before = document();
		const next = updateTranscriptWordText(
			{ ...before, transcript: before.transcripts[0] },
			"asset_1",
			"word_2",
			"everyone!",
		);
		expect(next.transcript?.words[1].text).toBe("everyone!");
		expect(next.transcript?.segments[0].text).toBe("Welcome everyone!");
		expect(next.transcript).toBe(next.transcripts[0]);
	});

	it("normalizes a multi-word correction but preserves timings and ids", () => {
		const before = document();
		const next = updateTranscriptWordText(before, "asset_1", "word_2", "  to   OpenScreen.  ");
		expect(next.transcripts[0].words[1]).toEqual({
			...before.transcripts[0].words[1],
			text: "to OpenScreen.",
		});
	});

	it("invalidates only this asset's stale translations", () => {
		let before = putCaptionTranslation(document(), {
			language: "fr",
			label: "Français",
			assetId: "asset_1",
			segments: { "u:segment_1": "Bienvenue" },
		});
		before = putCaptionTranslation(before, {
			language: "fr",
			label: "Français",
			assetId: "asset_2",
			segments: { "u:segment_2": "Ailleurs" },
		});
		const next = updateTranscriptWordText(before, "asset_1", "word_2", "everyone!");
		expect(getCaptionTranslations(next).fr.byAsset.asset_1).toBeUndefined();
		expect(getCaptionTranslations(next).fr.byAsset.asset_2).toEqual({
			"u:segment_2": "Ailleurs",
		});
	});

	it("does not write for a blank, unchanged, or unknown correction", () => {
		const before = document();
		expect(updateTranscriptWordText(before, "asset_1", "word_2", "  ")).toBe(before);
		expect(updateTranscriptWordText(before, "asset_1", "word_2", "home")).toBe(before);
		expect(updateTranscriptWordText(before, "asset_1", "missing", "text")).toBe(before);
	});
});
