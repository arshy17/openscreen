import { z } from "zod";
import { createId } from "./document/ids";
import type { AxcutAnnotationRegion, AxcutDocument } from "./schema";

export const privacyVisionScanRequestSchema = z.object({
	videoPath: z.string().min(1),
	sampleIntervalSec: z.number().min(0.25).max(30).optional(),
	maxSamples: z.number().int().min(1).max(600).optional(),
	includeFaces: z.boolean().optional(),
	includeText: z.boolean().optional(),
});

const privacyVisionKeyframeSchema = z.object({
	timeSec: z.number().nonnegative(),
	x: z.number().min(0).max(100),
	y: z.number().min(0).max(100),
	width: z.number().positive().max(100),
	height: z.number().positive().max(100),
});

export const privacyVisionCandidateSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["face", "email", "phone", "credential", "plate", "text"]),
	label: z.string().min(1).max(160),
	confidence: z.number().min(0).max(1),
	startSec: z.number().nonnegative(),
	endSec: z.number().positive(),
	previewText: z.string().max(120).nullish(),
	keyframes: z.array(privacyVisionKeyframeSchema).min(1).max(600),
});

export const privacyVisionScanResultSchema = z.object({
	success: z.literal(true),
	durationSec: z.number().positive(),
	sampledFrames: z.number().int().positive(),
	candidates: z.array(privacyVisionCandidateSchema).max(2_000),
});

export type PrivacyVisionScanRequest = z.infer<typeof privacyVisionScanRequestSchema>;
export type PrivacyVisionCandidate = z.infer<typeof privacyVisionCandidateSchema>;
export type PrivacyVisionScanResult = z.infer<typeof privacyVisionScanResultSchema>;
export type PrivacyVisionScanResponse =
	| PrivacyVisionScanResult
	| { success: false; error: string; unavailable?: boolean };

const clamp = (value: number, lower: number, upper: number) =>
	Math.min(upper, Math.max(lower, value));

/**
 * Convert user-confirmed Vision candidates into ordinary editable blur regions.
 * The candidates themselves are only a proposal: no caller should invoke this
 * until the review UI receives an explicit Apply action.
 */
export function applyVisionPrivacyCandidates(
	document: AxcutDocument,
	assetId: string,
	candidates: PrivacyVisionCandidate[],
): AxcutDocument {
	const clips = document.timeline.clips.filter((clip) => clip.assetId === assetId);
	if (clips.length === 0 || candidates.length === 0) return document;
	const regions: AxcutAnnotationRegion[] = [];
	for (const candidate of candidates) {
		const keyframes = [...candidate.keyframes].sort((a, b) => a.timeSec - b.timeSec);
		for (let index = 0; index < keyframes.length; index += 1) {
			const keyframe = keyframes[index];
			const segmentStart = Math.max(candidate.startSec, keyframe.timeSec);
			const segmentEnd = Math.max(
				segmentStart,
				Math.min(candidate.endSec, keyframes[index + 1]?.timeSec ?? candidate.endSec),
			);
			if (segmentEnd <= segmentStart) continue;
			for (const clip of clips) {
				const clipEnd = clip.sourceEndSec ?? Number.POSITIVE_INFINITY;
				const sourceStartSec = Math.max(segmentStart, clip.sourceStartSec);
				const sourceEndSec = Math.min(segmentEnd, clipEnd);
				if (sourceEndSec <= sourceStartSec) continue;
				const padding = 1.5;
				const x = clamp(keyframe.x - padding, 0, 100);
				const y = clamp(keyframe.y - padding, 0, 100);
				const width = clamp(keyframe.width + padding * 2, 0.5, 100 - x);
				const height = clamp(keyframe.height + padding * 2, 0.5, 100 - y);
				const timelineStartSec = clip.timelineStartSec + (sourceStartSec - clip.sourceStartSec);
				const timelineEndSec = clip.timelineStartSec + (sourceEndSec - clip.sourceStartSec);
				regions.push({
					id: createId("vision-mask"),
					startMs: Math.round(timelineStartSec * 1000),
					endMs: Math.round(timelineEndSec * 1000),
					clipId: clip.id,
					sourceStartSec,
					sourceEndSec,
					type: "blur",
					content: `Vision candidate: ${candidate.label}`,
					position: { x, y },
					size: { width, height },
					style: {
						color: "#ffffff",
						backgroundColor: "transparent",
						fontSize: 32,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
					},
					zIndex: document.annotations.length + regions.length + 1,
					blurData: {
						type: "mosaic",
						shape: "rectangle",
						color: "black",
						intensity: 18,
						blockSize: 18,
					},
				});
			}
		}
	}
	if (regions.length > 600) {
		throw new Error(
			"The selected candidates would create more than 600 editable masks. Apply fewer candidates at a time.",
		);
	}
	return { ...document, annotations: [...document.annotations, ...regions] };
}
