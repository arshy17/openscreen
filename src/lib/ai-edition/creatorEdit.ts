import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { type AnnotationIconPreset, annotationIconGlyph } from "./annotations/iconPresets";
import { type CaptionSettingsPatch, patchCaptionSettings } from "./captions";
import { createId } from "./document/ids";
import type { AxcutAnnotationRegion, AxcutDocument } from "./schema";
import { type EditorSettingsPatch, patchEditorSettings } from "./store/editorSettings";
import { buildAggregatedSections, isSilenceWord } from "./timeline/aggregated-transcript";
import { anchorRegionsWithDerivedMs } from "./timeline/timelineMap";

/**
 * Original, product-neutral creator styles. They deliberately describe editing
 * patterns rather than copying a named creator's trade dress.
 */
export type CreatorThemeId = "social-punch" | "clean-creator" | "tutorial-focus" | "minimal-pro";

export interface CreatorTheme {
	id: CreatorThemeId;
	label: string;
	description: string;
	aspectRatio: AspectRatio;
	captionPreset: "social" | "clean" | "minimal";
	editor: EditorSettingsPatch;
	captions: CaptionSettingsPatch;
	visuals: "energetic" | "restrained" | "none";
	aiDirection: string;
}

export const CREATOR_THEMES: readonly CreatorTheme[] = [
	{
		id: "social-punch",
		label: "Social Punch",
		description: "9:16, bold captions, lively callouts",
		aspectRatio: "9:16",
		captionPreset: "social",
		editor: {
			aspectRatio: "9:16",
			padding: 28,
			borderRadius: 32,
			shadowIntensity: 0.24,
			motionBlurAmount: 0.22,
		},
		captions: {
			enabled: true,
			fontSize: 58,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#000000",
			backgroundOpacity: 0.68,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 2,
			maxWordsPerLine: 5,
		},
		visuals: "energetic",
		aiDirection:
			"Create a lively vertical creator edit with tight pacing, short bold captions, and a few playful visual reactions. Keep the visual hierarchy clean and never cover the speaker, captions, or platform controls.",
	},
	{
		id: "clean-creator",
		label: "Clean Creator",
		description: "9:16, polished captions, subtle motion",
		aspectRatio: "9:16",
		captionPreset: "clean",
		editor: {
			aspectRatio: "9:16",
			padding: 34,
			borderRadius: 36,
			shadowIntensity: 0.2,
			motionBlurAmount: 0.16,
		},
		captions: {
			enabled: true,
			fontSize: 52,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#000000",
			backgroundOpacity: 0.56,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 2,
			maxWordsPerLine: 6,
		},
		visuals: "restrained",
		aiDirection:
			"Create a polished vertical creator edit with natural pacing, restrained emphasis, clean captions, and only a few useful visual callouts.",
	},
	{
		id: "tutorial-focus",
		label: "Tutorial Focus",
		description: "16:9, cursor-led zooms, clear teaching cues",
		aspectRatio: "16:9",
		captionPreset: "clean",
		editor: {
			aspectRatio: "16:9",
			padding: 50,
			borderRadius: 40,
			shadowIntensity: 0.2,
			motionBlurAmount: 0.18,
			autoFocusAll: true,
		},
		captions: {
			enabled: true,
			fontSize: 48,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#000000",
			backgroundOpacity: 0.55,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 2,
			maxWordsPerLine: 7,
		},
		visuals: "restrained",
		aiDirection:
			"Create a calm tutorial edit that prioritizes comprehension. Preserve every instructional action, use measured pacing, and add only callouts that clarify a step or outcome.",
	},
	{
		id: "minimal-pro",
		label: "Minimal Pro",
		description: "4:5, elegant captions, no decorative clutter",
		aspectRatio: "4:5",
		captionPreset: "minimal",
		editor: {
			aspectRatio: "4:5",
			padding: 38,
			borderRadius: 28,
			shadowIntensity: 0.14,
			motionBlurAmount: 0.12,
		},
		captions: {
			enabled: true,
			fontSize: 46,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: false,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 2,
			maxWordsPerLine: 6,
		},
		visuals: "none",
		aiDirection:
			"Create an understated professional edit. Tighten only obvious dead time, use elegant minimal captions, and avoid decorative icons or attention-grabbing effects.",
	},
] as const;

const CREATOR_THEME_BY_ID = new Map(CREATOR_THEMES.map((theme) => [theme.id, theme]));

export function getCreatorTheme(id: CreatorThemeId): CreatorTheme {
	return CREATOR_THEME_BY_ID.get(id) ?? CREATOR_THEMES[0];
}

interface KeywordVisual {
	icon: AnnotationIconPreset;
	terms: readonly string[];
}

const KEYWORD_VISUALS: readonly KeywordVisual[] = [
	{ icon: "warning", terms: ["warning", "careful", "problem", "error", "issue", "risk"] },
	{ icon: "idea", terms: ["idea", "tip", "trick", "learn", "insight"] },
	{ icon: "celebrate", terms: ["great", "amazing", "perfect", "success", "won", "launch"] },
	{ icon: "check", terms: ["done", "complete", "correct", "works", "ready", "yes"] },
	{ icon: "target", terms: ["goal", "target", "focus", "result", "objective"] },
	{ icon: "heart", terms: ["love", "like", "favorite", "favourite"] },
	{ icon: "question", terms: ["why", "question", "wonder", "how"] },
	{ icon: "arrow", terms: ["next", "then", "continue", "forward", "follow"] },
	{ icon: "fire", terms: ["hot", "powerful", "fast", "boost", "viral"] },
] as const;

function normaliseWord(text: string): string {
	return text.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function visualForWord(text: string): AnnotationIconPreset | null {
	const word = normaliseWord(text);
	if (!word) return null;
	return KEYWORD_VISUALS.find((entry) => entry.terms.includes(word))?.icon ?? null;
}

const MIN_VISUAL_GAP_SEC = 10;
const MAX_VISUALS = 8;

function automaticVisuals(document: AxcutDocument, theme: CreatorTheme): AxcutAnnotationRegion[] {
	if (theme.visuals === "none") return [];
	const sections = buildAggregatedSections(
		document.timeline.clips,
		document.transcripts,
		document.assets,
		document.timeline.trimRanges,
	);
	const existingStarts = document.annotations.map((annotation) => annotation.startMs / 1000);
	const candidates: Array<{
		clipId: string;
		startSec: number;
		endSec: number;
		icon: AnnotationIconPreset;
	}> = [];

	for (const section of sections) {
		for (const tagged of section.words) {
			if (!tagged.kept || isSilenceWord(tagged.word)) continue;
			const icon = visualForWord(tagged.word.text);
			if (!icon) continue;
			const rawStart =
				section.clip.timelineStartSec + (tagged.word.startSec - section.clip.sourceStartSec);
			if (existingStarts.some((start) => Math.abs(start - rawStart) < MIN_VISUAL_GAP_SEC)) continue;
			if (
				candidates.some((candidate) => Math.abs(candidate.startSec - rawStart) < MIN_VISUAL_GAP_SEC)
			) {
				continue;
			}
			const clipEnd = section.clip.timelineEndSec;
			candidates.push({
				clipId: section.clip.id,
				startSec: Math.max(section.clip.timelineStartSec, rawStart - 0.15),
				endSec: Math.min(clipEnd, rawStart + (theme.visuals === "energetic" ? 1.8 : 1.35)),
				icon,
			});
			if (candidates.length >= MAX_VISUALS) break;
		}
		if (candidates.length >= MAX_VISUALS) break;
	}

	return candidates.flatMap((candidate, index) => {
		const leftSide = index % 2 === 0;
		const annotation: AxcutAnnotationRegion = {
			id: createId("ann"),
			startMs: Math.round(candidate.startSec * 1000),
			endMs: Math.round(Math.max(candidate.startSec + 0.4, candidate.endSec) * 1000),
			type: "text",
			content: annotationIconGlyph(candidate.icon),
			textContent: annotationIconGlyph(candidate.icon),
			position: { x: leftSide ? 24 : 76, y: theme.aspectRatio === "16:9" ? 26 : 24 },
			size: { width: 18, height: 18 },
			style: {
				color: theme.visuals === "energetic" ? "#fbbf24" : "#ffffff",
				backgroundColor: "transparent",
				fontSize: theme.visuals === "energetic" ? 78 : 66,
				fontFamily: "Inter",
				fontWeight: "bold",
				fontStyle: "normal",
				textDecoration: "none",
				textAlign: "center",
				textAnimation: theme.visuals === "energetic" ? "pop" : "fade",
			},
			zIndex: document.annotations.length + index + 1,
		};
		return anchorRegionsWithDerivedMs([annotation], document.timeline.clips, () =>
			createId("ann"),
		) as AxcutAnnotationRegion[];
	});
}

export interface AppliedCreatorTheme {
	document: AxcutDocument;
	visualsAdded: number;
	hasTranscript: boolean;
}

/** Apply the useful, deterministic half of a creator edit without any model call. */
export function applyCreatorTheme(
	document: AxcutDocument,
	themeId: CreatorThemeId,
): AppliedCreatorTheme {
	const theme = getCreatorTheme(themeId);
	let next = patchEditorSettings(document, theme.editor);
	const aspectValue = getAspectRatioValue(theme.aspectRatio);
	next = patchCaptionSettings(next, theme.captions, aspectValue);
	const visuals = automaticVisuals(next, theme);
	return {
		document: {
			...next,
			annotations: [...next.annotations, ...visuals],
		},
		visualsAdded: visuals.length,
		hasTranscript: next.transcripts.some((transcript) => transcript.words.length > 0),
	};
}

/**
 * The model prompt is deliberately explicit about restraint and evidence. It can
 * use a local OpenAI-compatible endpoint (including Qwen) or any configured
 * remote provider; no cloud-only feature is assumed.
 */
export function buildCreatorEditPrompt(themeId: CreatorThemeId): string {
	const theme = getCreatorTheme(themeId);
	const visualDirection =
		theme.visuals === "none"
			? "Do not add decorative icons."
			: `Add no more than one relevant visual callout per 10 seconds and no more than 8 total. Use only built-in icons (sparkles, star, check, arrow, heart, warning, target, dot, idea, fire, celebrate, thumbs-up, question or lightning). Match each icon to words actually spoken; do not invent claims. Keep every overlay inside the central safe area, away from captions and the bottom/right platform controls.`;

	return [
		`Apply a complete creator edit using the ${theme.label} theme.`,
		theme.aiDirection,
		"Work directly on the current timeline and preserve every user-placed clip and existing manual edit.",
		"First inspect the current document and the transcript for every asset used by a clip.",
		`Set the output format to ${theme.aspectRatio} and enable the ${theme.captionPreset} caption preset.`,
		"Tighten only clear dead time, long pauses, and obvious verbal restarts. Keep breaths and natural conversational rhythm; never remove an instruction, demonstration step, disclaimer, or meaningful reaction. Batch multiple cuts with addTrims.",
		"For screen recordings, read cursor telemetry before adding zooms. Add only a few zooms at real dwell/click moments, batch them with addZooms, and do not guess a pointer position from transcript text. If telemetry is unavailable, skip automatic zooms.",
		visualDirection,
		"If a webcam track exists, you may add at most two short camera-fullscreen moments for a spoken hook or personal reaction; otherwise skip them.",
		"Use animations sparingly: pop for an icon, rise or fade for short text, and no continuous pulse unless the user explicitly asks for it.",
		"Do not add external copyrighted media, music, or generated claims. Do not export or publish. When finished, re-read the document and report exactly what changed and anything you intentionally skipped.",
	].join("\n");
}
