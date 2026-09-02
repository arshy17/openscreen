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
export type CreatorThemeId =
	| "social-punch"
	| "clean-creator"
	| "shorts-hook"
	| "story-spotlight"
	| "tutorial-focus"
	| "youtube-explainer"
	| "instagram-feed"
	| "podcast-pro"
	| "minimal-pro";

export type CreatorThemeCategory = "Shorts & Reels" | "YouTube" | "Social feed" | "Professional";

export type CreatorPlatform =
	| "Instagram Reels"
	| "TikTok"
	| "YouTube Shorts"
	| "Stories & Spotlight"
	| "YouTube"
	| "Instagram Feed"
	| "Podcast & Webinar"
	| "Professional Feed";

export interface CreatorSafeArea {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface CreatorThemePreview {
	background: string;
	accent: string;
	layout: "screen" | "split" | "camera";
	camera: "none" | "circle" | "rounded";
	caption: "bold" | "clean" | "minimal";
}

export interface CreatorTheme {
	id: CreatorThemeId;
	label: string;
	description: string;
	category: CreatorThemeCategory;
	platform: CreatorPlatform;
	aspectRatio: AspectRatio;
	exportSize: { width: number; height: number };
	safeArea: CreatorSafeArea;
	captionPreset: "social" | "clean" | "minimal";
	editor: EditorSettingsPatch;
	captions: CaptionSettingsPatch;
	visuals: "energetic" | "restrained" | "none";
	preview: CreatorThemePreview;
	aiDirection: string;
}

export const CREATOR_THEMES: readonly CreatorTheme[] = [
	{
		id: "social-punch",
		label: "Instagram Reel",
		description: "1080×1920 · platform-safe captions and lively callouts",
		category: "Shorts & Reels",
		platform: "Instagram Reels",
		aspectRatio: "9:16",
		exportSize: { width: 1080, height: 1920 },
		safeArea: { top: 8, right: 16, bottom: 18, left: 7 },
		captionPreset: "social",
		editor: {
			aspectRatio: "9:16",
			wallpaper: "linear-gradient(145deg, #5b21b6 0%, #db2777 55%, #f97316 100%)",
			padding: 12,
			borderRadius: 32,
			shadowIntensity: 0.24,
			motionBlurAmount: 0.22,
			autoFocusAll: true,
			webcamLayoutPreset: "picture-in-picture",
			webcamMaskShape: "circle",
			webcamSizePreset: 20,
			webcamPosition: { cx: 0.23, cy: 0.2 },
		},
		captions: {
			enabled: true,
			fontSize: 46,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#000000",
			backgroundOpacity: 0.68,
			anchorV: "bottom",
			anchorH: "center",
			insetY: 18,
			insetX: 7,
			minWordsPerLine: 2,
			maxWordsPerLine: 5,
		},
		visuals: "energetic",
		preview: {
			background: "linear-gradient(145deg, #5b21b6, #db2777 60%, #f97316)",
			accent: "#fbbf24",
			layout: "screen",
			camera: "circle",
			caption: "bold",
		},
		aiDirection:
			"Create a lively vertical creator edit with tight pacing, short bold captions, and a few playful visual reactions. Keep the visual hierarchy clean and never cover the speaker, captions, or platform controls.",
	},
	{
		id: "clean-creator",
		label: "TikTok Creator",
		description: "1080×1920 · clean UI-safe framing and captions",
		category: "Shorts & Reels",
		platform: "TikTok",
		aspectRatio: "9:16",
		exportSize: { width: 1080, height: 1920 },
		safeArea: { top: 10, right: 17, bottom: 20, left: 7 },
		captionPreset: "clean",
		editor: {
			aspectRatio: "9:16",
			wallpaper: "linear-gradient(160deg, #0f172a 0%, #1e3a8a 48%, #0ea5e9 100%)",
			padding: 10,
			borderRadius: 36,
			shadowIntensity: 0.2,
			motionBlurAmount: 0.16,
			autoFocusAll: true,
			webcamLayoutPreset: "picture-in-picture",
			webcamMaskShape: "rounded",
			webcamSizePreset: 18,
			webcamPosition: { cx: 0.23, cy: 0.21 },
		},
		captions: {
			enabled: true,
			fontSize: 44,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#000000",
			backgroundOpacity: 0.56,
			anchorV: "bottom",
			anchorH: "center",
			insetY: 20,
			insetX: 7,
			minWordsPerLine: 2,
			maxWordsPerLine: 6,
		},
		visuals: "restrained",
		preview: {
			background: "linear-gradient(160deg, #0f172a, #1e3a8a 55%, #0ea5e9)",
			accent: "#38bdf8",
			layout: "screen",
			camera: "rounded",
			caption: "clean",
		},
		aiDirection:
			"Create a polished vertical creator edit with natural pacing, restrained emphasis, clean captions, and only a few useful visual callouts.",
	},
	{
		id: "shorts-hook",
		label: "YouTube Short",
		description: "1080×1920 · fast hook and high-contrast safe captions",
		category: "Shorts & Reels",
		platform: "YouTube Shorts",
		aspectRatio: "9:16",
		exportSize: { width: 1080, height: 1920 },
		safeArea: { top: 8, right: 15, bottom: 16, left: 7 },
		captionPreset: "social",
		editor: {
			aspectRatio: "9:16",
			wallpaper: "linear-gradient(150deg, #111827 0%, #7c3aed 58%, #22d3ee 100%)",
			padding: 11,
			borderRadius: 28,
			shadowIntensity: 0.28,
			motionBlurAmount: 0.2,
			autoFocusAll: true,
			webcamLayoutPreset: "picture-in-picture",
			webcamMaskShape: "circle",
			webcamSizePreset: 20,
			webcamPosition: { cx: 0.23, cy: 0.2 },
		},
		captions: {
			enabled: true,
			fontSize: 48,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#111827",
			backgroundOpacity: 0.78,
			anchorV: "bottom",
			anchorH: "center",
			insetY: 16,
			insetX: 7,
			minWordsPerLine: 1,
			maxWordsPerLine: 4,
		},
		visuals: "energetic",
		preview: {
			background: "linear-gradient(150deg, #111827, #7c3aed 60%, #22d3ee)",
			accent: "#22d3ee",
			layout: "camera",
			camera: "circle",
			caption: "bold",
		},
		aiDirection:
			"Create a concise vertical short with a clear opening hook, brisk but understandable pacing, punchy captions, and only evidence-based visual reactions.",
	},
	{
		id: "story-spotlight",
		label: "Story / Spotlight",
		description: "1080×1920 · calm storytelling with generous UI-safe margins",
		category: "Shorts & Reels",
		platform: "Stories & Spotlight",
		aspectRatio: "9:16",
		exportSize: { width: 1080, height: 1920 },
		safeArea: { top: 10, right: 14, bottom: 18, left: 7 },
		captionPreset: "clean",
		editor: {
			aspectRatio: "9:16",
			wallpaper: "linear-gradient(155deg, #042f2e 0%, #0f766e 52%, #6366f1 100%)",
			padding: 12,
			borderRadius: 34,
			shadowIntensity: 0.18,
			motionBlurAmount: 0.12,
			autoFocusAll: true,
			webcamLayoutPreset: "picture-in-picture",
			webcamMaskShape: "rounded",
			webcamSizePreset: 18,
			webcamPosition: { cx: 0.23, cy: 0.21 },
		},
		captions: {
			enabled: true,
			fontSize: 44,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#042f2e",
			backgroundOpacity: 0.58,
			anchorV: "bottom",
			anchorH: "center",
			insetY: 18,
			insetX: 7,
			minWordsPerLine: 2,
			maxWordsPerLine: 6,
		},
		visuals: "restrained",
		preview: {
			background: "linear-gradient(155deg, #042f2e, #0f766e 55%, #6366f1)",
			accent: "#5eead4",
			layout: "screen",
			camera: "rounded",
			caption: "clean",
		},
		aiDirection:
			"Create a calm vertical story with a clear narrative arc, comfortable pacing, UI-safe captions, and only a few relevant visual accents.",
	},
	{
		id: "tutorial-focus",
		label: "YouTube Tutorial",
		description: "16:9, cursor-led zooms, clear teaching cues",
		category: "YouTube",
		platform: "YouTube",
		aspectRatio: "16:9",
		exportSize: { width: 1920, height: 1080 },
		safeArea: { top: 5, right: 5, bottom: 8, left: 5 },
		captionPreset: "clean",
		editor: {
			aspectRatio: "16:9",
			wallpaper: "linear-gradient(145deg, #020617 0%, #172554 52%, #1d4ed8 100%)",
			padding: 50,
			borderRadius: 40,
			shadowIntensity: 0.2,
			motionBlurAmount: 0.18,
			autoFocusAll: true,
			webcamMaskShape: "rounded",
			webcamSizePreset: 21,
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
		preview: {
			background: "linear-gradient(145deg, #020617, #172554 55%, #1d4ed8)",
			accent: "#60a5fa",
			layout: "screen",
			camera: "rounded",
			caption: "clean",
		},
		aiDirection:
			"Create a calm tutorial edit that prioritizes comprehension. Preserve every instructional action, use measured pacing, and add only callouts that clarify a step or outcome.",
	},
	{
		id: "youtube-explainer",
		label: "YouTube Explainer",
		description: "16:9, presenter-led, chapter-ready pacing",
		category: "YouTube",
		platform: "YouTube",
		aspectRatio: "16:9",
		exportSize: { width: 1920, height: 1080 },
		safeArea: { top: 5, right: 5, bottom: 8, left: 5 },
		captionPreset: "clean",
		editor: {
			aspectRatio: "16:9",
			wallpaper: "linear-gradient(135deg, #111827 0%, #312e81 55%, #7c3aed 100%)",
			padding: 44,
			borderRadius: 34,
			shadowIntensity: 0.22,
			motionBlurAmount: 0.14,
			webcamMaskShape: "circle",
			webcamSizePreset: 28,
		},
		captions: {
			enabled: true,
			fontSize: 46,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#111827",
			backgroundOpacity: 0.56,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 2,
			maxWordsPerLine: 7,
		},
		visuals: "restrained",
		preview: {
			background: "linear-gradient(135deg, #111827, #312e81 55%, #7c3aed)",
			accent: "#a78bfa",
			layout: "split",
			camera: "circle",
			caption: "clean",
		},
		aiDirection:
			"Create a presenter-led YouTube explainer with a strong introduction, clear visual hierarchy, comfortable chapter-like pacing, and concise supporting callouts.",
	},
	{
		id: "instagram-feed",
		label: "Instagram Feed",
		description: "4:5, editorial framing, safe social captions",
		category: "Social feed",
		platform: "Instagram Feed",
		aspectRatio: "4:5",
		exportSize: { width: 1080, height: 1350 },
		safeArea: { top: 6, right: 6, bottom: 12, left: 6 },
		captionPreset: "clean",
		editor: {
			aspectRatio: "4:5",
			wallpaper: "linear-gradient(145deg, #431407 0%, #be123c 50%, #f59e0b 100%)",
			padding: 34,
			borderRadius: 34,
			shadowIntensity: 0.2,
			motionBlurAmount: 0.14,
			webcamMaskShape: "rounded",
			webcamSizePreset: 24,
		},
		captions: {
			enabled: true,
			fontSize: 50,
			fontWeight: "bold",
			color: "#ffffff",
			backgroundEnabled: true,
			backgroundColor: "#3f0d17",
			backgroundOpacity: 0.62,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 2,
			maxWordsPerLine: 6,
		},
		visuals: "restrained",
		preview: {
			background: "linear-gradient(145deg, #431407, #be123c 50%, #f59e0b)",
			accent: "#fbbf24",
			layout: "screen",
			camera: "rounded",
			caption: "clean",
		},
		aiDirection:
			"Create a polished 4:5 social feed edit with warm editorial framing, readable platform-safe captions, and a small number of relevant visual accents.",
	},
	{
		id: "podcast-pro",
		label: "Podcast Pro",
		description: "16:9, larger speaker, calm branded captions",
		category: "Professional",
		platform: "Podcast & Webinar",
		aspectRatio: "16:9",
		exportSize: { width: 1920, height: 1080 },
		safeArea: { top: 5, right: 5, bottom: 8, left: 5 },
		captionPreset: "clean",
		editor: {
			aspectRatio: "16:9",
			wallpaper: "linear-gradient(135deg, #052e16 0%, #064e3b 52%, #0f766e 100%)",
			padding: 42,
			borderRadius: 32,
			shadowIntensity: 0.18,
			motionBlurAmount: 0.1,
			webcamMaskShape: "rounded",
			webcamSizePreset: 34,
		},
		captions: {
			enabled: true,
			fontSize: 44,
			fontWeight: "bold",
			color: "#ecfdf5",
			backgroundEnabled: true,
			backgroundColor: "#022c22",
			backgroundOpacity: 0.64,
			anchorV: "bottom",
			anchorH: "center",
			minWordsPerLine: 3,
			maxWordsPerLine: 8,
		},
		visuals: "none",
		preview: {
			background: "linear-gradient(135deg, #052e16, #064e3b 52%, #0f766e)",
			accent: "#34d399",
			layout: "camera",
			camera: "rounded",
			caption: "clean",
		},
		aiDirection:
			"Create a calm professional podcast edit that prioritizes the speaker, removes only genuine dead air, and uses restrained branded captions without decorative clutter.",
	},
	{
		id: "minimal-pro",
		label: "Minimal Pro",
		description: "4:5, elegant captions, no decorative clutter",
		category: "Professional",
		platform: "Professional Feed",
		aspectRatio: "4:5",
		exportSize: { width: 1080, height: 1350 },
		safeArea: { top: 6, right: 6, bottom: 10, left: 6 },
		captionPreset: "minimal",
		editor: {
			aspectRatio: "4:5",
			wallpaper: "linear-gradient(145deg, #e5e7eb 0%, #94a3b8 48%, #334155 100%)",
			padding: 38,
			borderRadius: 28,
			shadowIntensity: 0.14,
			motionBlurAmount: 0.12,
			webcamMaskShape: "rectangle",
			webcamSizePreset: 20,
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
		preview: {
			background: "linear-gradient(145deg, #e5e7eb, #94a3b8 48%, #334155)",
			accent: "#e2e8f0",
			layout: "screen",
			camera: "none",
			caption: "minimal",
		},
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
	label: string;
	terms: readonly string[];
}

const KEYWORD_VISUALS: readonly KeywordVisual[] = [
	{
		icon: "warning",
		label: "WATCH",
		terms: ["warning", "careful", "problem", "error", "issue", "risk"],
	},
	{
		icon: "idea",
		label: "TIP",
		terms: ["idea", "tip", "trick", "learn", "insight"],
	},
	{
		icon: "celebrate",
		label: "YES",
		terms: ["great", "amazing", "perfect", "success", "won", "launch"],
	},
	{
		icon: "check",
		label: "DONE",
		terms: ["done", "complete", "correct", "works", "ready", "yes"],
	},
	{
		icon: "target",
		label: "FOCUS",
		terms: ["goal", "target", "focus", "result", "objective"],
	},
	{
		icon: "heart",
		label: "LOVE",
		terms: ["love", "like", "favorite", "favourite"],
	},
	{
		icon: "question",
		label: "WHY?",
		terms: ["why", "question", "wonder", "how"],
	},
	{
		icon: "arrow",
		label: "NEXT",
		terms: ["next", "then", "continue", "forward", "follow"],
	},
	{
		icon: "fire",
		label: "HOT",
		terms: ["hot", "powerful", "fast", "boost", "viral"],
	},
] as const;

// Original, locally bundled three-frame sparkle. Keeping one small safe asset in the theme
// engine means an energetic edit can add a genuinely animated reaction without downloading
// third-party GIFs, leaking transcript text to a search service, or copying a creator's pack.
const BUILT_IN_SPARKLE_GIF =
	"data:image/gif;base64,R0lGODlhEAAQAPQAAAAAAPu/JP3mivu/JPu/JPu/JP3mivu/JPu/JPu/JPu/JP3mivu/JP3mivu/JPu/JPu/JPu/JPu/JPu/JP3mivu/JP3mivu/JP3migAAAAAAAAAAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQNCgAAACwBAAEADwAPAAAFRyAgjsBFnqRyKSg6XVNLFlddyOJTX8+5/8DdQBIESggiR7HmOCWKCdSheEBBihDUrkKo7E7TS2QUqVVHV8aJccmOLmewCRACACH5BA0KAAAALAMAAwALAAsAAAUsICCK2GiKBmacY4M1rGhhlondeF5S+k2NC93ClMqtWjrYaPbj1UaYoSgoCgEAOw==";

function normaliseWord(text: string): string {
	return text.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function visualForWord(text: string): KeywordVisual | null {
	const word = normaliseWord(text);
	if (!word) return null;
	return KEYWORD_VISUALS.find((entry) => entry.terms.includes(word)) ?? null;
}

const MIN_VISUAL_GAP_SEC = 10;

function automaticVisuals(document: AxcutDocument, theme: CreatorTheme): AxcutAnnotationRegion[] {
	if (theme.visuals === "none") return [];
	const visualLimit = theme.aspectRatio === "9:16" ? (theme.visuals === "energetic" ? 5 : 3) : 6;
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
		visual: KeywordVisual;
	}> = [];

	for (const section of sections) {
		for (const tagged of section.words) {
			if (!tagged.kept || isSilenceWord(tagged.word)) continue;
			const visual = visualForWord(tagged.word.text);
			if (!visual) continue;
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
				visual,
			});
			if (candidates.length >= visualLimit) break;
		}
		if (candidates.length >= visualLimit) break;
	}

	return candidates.flatMap((candidate, index) => {
		const vertical = theme.aspectRatio === "9:16";
		const animatedSticker =
			theme.visuals === "energetic" &&
			(candidate.visual.icon === "celebrate" || candidate.visual.icon === "fire");
		const width = animatedSticker ? (vertical ? 13 : 10) : vertical ? 27 : 20;
		const height = animatedSticker ? (vertical ? 8 : 11) : vertical ? 7 : 11;
		const leftX = Math.min(100 - theme.safeArea.right - width, theme.safeArea.left + 2);
		const rightX = Math.max(theme.safeArea.left, 100 - theme.safeArea.right - width - 2);
		const portraitSlots = [
			{ x: rightX, y: theme.safeArea.top + 3 },
			{ x: leftX, y: 34 },
			{ x: rightX, y: 43 },
			{ x: leftX, y: 51 },
		] as const;
		const landscapeSlots = [
			{ x: leftX, y: theme.safeArea.top + 3 },
			{ x: rightX, y: theme.safeArea.top + 3 },
			{ x: leftX, y: 28 },
			{ x: rightX, y: 28 },
		] as const;
		const position = (vertical ? portraitSlots : landscapeSlots)[index % 4];
		const glyph = annotationIconGlyph(candidate.visual.icon);
		const annotation: AxcutAnnotationRegion = {
			id: createId("ann"),
			startMs: Math.round(candidate.startSec * 1000),
			endMs: Math.round(Math.max(candidate.startSec + 0.4, candidate.endSec) * 1000),
			type: animatedSticker ? "image" : "text",
			content: animatedSticker ? BUILT_IN_SPARKLE_GIF : `${glyph} ${candidate.visual.label}`,
			...(animatedSticker
				? { imageContent: BUILT_IN_SPARKLE_GIF }
				: { textContent: `${glyph} ${candidate.visual.label}` }),
			position,
			size: { width, height },
			style: {
				color: "#ffffff",
				backgroundColor: animatedSticker
					? "transparent"
					: theme.visuals === "energetic"
						? "#111827"
						: "#0f172a",
				fontSize: vertical
					? theme.visuals === "energetic"
						? 38
						: 34
					: theme.visuals === "energetic"
						? 44
						: 38,
				fontFamily: "Inter",
				fontWeight: "bold",
				fontStyle: "normal",
				textDecoration: "none",
				textAlign: "center",
				textAnimation: animatedSticker ? "none" : theme.visuals === "energetic" ? "pop" : "rise",
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

export interface ApplyCreatorThemeOptions {
	/**
	 * Built-in callouts are useful for a one-click style, but they must never be
	 * compulsory. The Creator Toolkit can therefore apply only the composition
	 * and caption design while leaving the user's annotations untouched.
	 */
	visuals?: boolean;
}

/** Apply the useful, deterministic half of a creator edit without any model call. */
export function applyCreatorTheme(
	document: AxcutDocument,
	themeId: CreatorThemeId,
	options: ApplyCreatorThemeOptions = {},
): AppliedCreatorTheme {
	const theme = getCreatorTheme(themeId);
	let next = patchEditorSettings(document, theme.editor);
	const aspectValue = getAspectRatioValue(theme.aspectRatio);
	next = patchCaptionSettings(next, theme.captions, aspectValue);
	const visuals = options.visuals === false ? [] : automaticVisuals(next, theme);
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

	return [
		"OpenScreen Creator Edit mode.",
		`Complete the semantic editing pass for the ${theme.label} theme.`,
		`OpenScreen has already applied the ${theme.aspectRatio} composition, ${theme.captionPreset} captions, and the theme's safe built-in visuals before this turn. Preserve those settings; do not call setOutputFormat or setCaptions unless inspection shows they are missing.`,
		"OpenScreen has preloaded one bounded current-document snapshot and the complete compact phrase transcript for every placed asset into this turn. Use that context directly; do not ask to read it again.",
		"This focused pass exposes only addTrims. Call it at most once with no more than five high-confidence cuts in the bounded section; do not request any other tool.",
		"Work directly on the current timeline and preserve every user-placed clip and existing manual edit.",
		"Inspect the preloaded snapshot and phrase transcripts before writing. Each phrase preserves source-time edges and exposes pauseAfterSec; the context reports whether every page is complete.",
		"The document read may preview a dense existing effect list. Preserve all existing effects; effectPages reports the exact totals.",
		"Tighten only clear dead time, long pauses, and obvious verbal restarts. Keep breaths and natural conversational rhythm; never remove an instruction, demonstration step, disclaimer, or meaningful reaction. Batch multiple cuts with addTrims.",
		"Preserve the existing zooms. This focused semantic pass intentionally does not expose pointer telemetry or zoom-writing tools, so never guess a new zoom from transcript text.",
		"Composition, captions, built-in visuals, animations and camera styling are already applied by the selected theme. Do not duplicate or reconsider them here.",
		"Do not export or publish. When finished, report exactly which cuts succeeded, or say that this section needed no safe cut.",
	].join("\n");
}
