import type { ArtworkSuggestionVariant } from "@/native/contracts";
import { createId } from "./document/ids";
import { rederiveRegionMs, resequenceClips } from "./document/timeline";
import type {
	ArtworkDesign,
	ArtworkLayer,
	ArtworkTextLayer,
	AxcutAsset,
	AxcutDocument,
} from "./schema";

export const ARTWORK_PRESET_REGISTRY_VERSION = 1;

export interface ArtworkSafeArea {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface ArtworkPreset {
	id: string;
	name: string;
	platform: string;
	width: number;
	height: number;
	safeArea: ArtworkSafeArea;
	mockup: "phone" | "feed" | "search" | "podcast" | "link";
	description: string;
}

export const ARTWORK_PRESETS: readonly ArtworkPreset[] = [
	{
		id: "youtube-thumbnail",
		name: "YouTube thumbnail",
		platform: "YouTube",
		width: 3840,
		height: 2160,
		safeArea: { top: 0.06, right: 0.06, bottom: 0.1, left: 0.06 },
		mockup: "search",
		description: "Large 16:9 master",
	},
	{
		id: "youtube-thumbnail-compat",
		name: "YouTube compatibility copy",
		platform: "YouTube",
		width: 1280,
		height: 720,
		safeArea: { top: 0.06, right: 0.06, bottom: 0.1, left: 0.06 },
		mockup: "search",
		description: "Classic 1280×720 copy",
	},
	{
		id: "reels-cover",
		name: "Instagram Reels cover",
		platform: "Instagram",
		width: 1080,
		height: 1920,
		safeArea: { top: 0.14, right: 0.08, bottom: 0.2, left: 0.08 },
		mockup: "phone",
		description: "9:16 with Reels UI safe area",
	},
	{
		id: "tiktok-cover",
		name: "TikTok cover",
		platform: "TikTok",
		width: 1080,
		height: 1920,
		safeArea: { top: 0.12, right: 0.18, bottom: 0.2, left: 0.08 },
		mockup: "phone",
		description: "9:16 with action-rail clearance",
	},
	{
		id: "shorts-cover",
		name: "YouTube Shorts frame cover",
		platform: "YouTube Shorts",
		width: 1080,
		height: 1920,
		safeArea: { top: 0.12, right: 0.16, bottom: 0.2, left: 0.08 },
		mockup: "phone",
		description: "Frame artwork for a Shorts video",
	},
	{
		id: "instagram-portrait",
		name: "Instagram portrait",
		platform: "Instagram",
		width: 1080,
		height: 1350,
		safeArea: { top: 0.06, right: 0.06, bottom: 0.08, left: 0.06 },
		mockup: "feed",
		description: "4:5 feed artwork",
	},
	{
		id: "square-cover",
		name: "Square social cover",
		platform: "Social",
		width: 1080,
		height: 1080,
		safeArea: { top: 0.07, right: 0.07, bottom: 0.07, left: 0.07 },
		mockup: "feed",
		description: "1:1 universal post",
	},
	{
		id: "podcast-cover",
		name: "Podcast cover",
		platform: "Podcasts",
		width: 3000,
		height: 3000,
		safeArea: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 },
		mockup: "podcast",
		description: "3000×3000 podcast master",
	},
	{
		id: "wide-social",
		name: "Wide social / link preview",
		platform: "Social",
		width: 1200,
		height: 628,
		safeArea: { top: 0.07, right: 0.07, bottom: 0.07, left: 0.07 },
		mockup: "link",
		description: "1200×628 link card",
	},
] as const;

export function getArtworkPreset(id: string): ArtworkPreset {
	return ARTWORK_PRESETS.find((preset) => preset.id === id) ?? ARTWORK_PRESETS[0];
}

export function createArtworkDesign(
	presetId: string,
	projectTitle: string,
	source?: { assetId?: string; timeSec?: number },
): ArtworkDesign {
	const preset = getArtworkPreset(presetId);
	const now = new Date().toISOString();
	const titleLayer: ArtworkTextLayer = {
		id: createId("artlayer"),
		name: "Headline",
		type: "text",
		text: projectTitle || "Your headline",
		x: preset.width * 0.08,
		y: preset.height * 0.62,
		width: preset.width * 0.78,
		height: preset.height * 0.25,
		rotation: 0,
		opacity: 1,
		visible: true,
		zIndex: 10,
		fontFamily: "Inter",
		fontSize: Math.max(56, Math.round(preset.width * 0.074)),
		fontWeight: 800,
		color: "#ffffff",
		align: "left",
		strokeColor: "#000000",
		strokeWidth: Math.max(0, Math.round(preset.width * 0.0015)),
		shadowColor: "#00000099",
		shadowBlur: Math.round(preset.width * 0.008),
	};
	return {
		id: createId("artwork"),
		name: `${preset.name} 1`,
		presetId: preset.id,
		presetRegistryVersion: ARTWORK_PRESET_REGISTRY_VERSION,
		width: preset.width,
		height: preset.height,
		background: { kind: "gradient", value: "linear-gradient(135deg,#111827,#2563eb)" },
		layers: [titleLayer],
		safeAreaPreset: preset.id,
		...(source?.assetId ? { sourceAssetId: source.assetId } : {}),
		...(source?.timeSec !== undefined ? { sourceTimeSec: source.timeSec } : {}),
		revision: 0,
		revisions: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function updateArtworkDesign(
	design: ArtworkDesign,
	patch: Partial<Pick<ArtworkDesign, "name" | "background" | "layers">>,
	label: string,
): ArtworkDesign {
	const now = new Date().toISOString();
	return {
		...design,
		...patch,
		revision: design.revision + 1,
		updatedAt: now,
		revisions: [
			...design.revisions.slice(-19),
			{ id: createId("artrev"), createdAt: now, label, layers: structuredClone(design.layers) },
		],
	};
}

export function applyArtworkSuggestion(
	design: ArtworkDesign,
	variant: ArtworkSuggestionVariant,
): ArtworkDesign {
	const preset = getArtworkPreset(design.presetId);
	const existingImages = design.layers.filter((layer) => layer.type === "image");
	const subjectLeft = variant.layout === "subject-left";
	const centered = variant.layout === "centered";
	const shape: ArtworkLayer = {
		id: createId("artlayer"),
		name: "Headline plate",
		type: "shape",
		shape: "rounded-rectangle",
		x: preset.width * (centered ? 0.1 : subjectLeft ? 0.47 : 0.06),
		y: preset.height * 0.55,
		width: preset.width * (centered ? 0.8 : 0.48),
		height: preset.height * 0.28,
		rotation: 0,
		opacity: 0.88,
		visible: true,
		zIndex: 8,
		fill: "#090f1fdd",
		stroke: variant.accentColor,
		strokeWidth: Math.max(2, Math.round(preset.width * 0.003)),
		cornerRadius: Math.round(preset.width * 0.025),
	};
	const headline: ArtworkTextLayer = {
		id: createId("artlayer"),
		name: "AI headline",
		type: "text",
		text: variant.headline,
		x: shape.x + preset.width * 0.025,
		y: shape.y + preset.height * 0.035,
		width: shape.width - preset.width * 0.05,
		height: shape.height - preset.height * 0.07,
		rotation: 0,
		opacity: 1,
		visible: true,
		zIndex: 9,
		fontFamily: "Inter",
		fontSize: Math.max(52, Math.round(preset.width * (centered ? 0.065 : 0.054))),
		fontWeight: 800,
		color: "#ffffff",
		align: centered ? "center" : "left",
		strokeColor: "#000000",
		strokeWidth: 0,
		shadowColor: "#00000099",
		shadowBlur: Math.round(preset.width * 0.006),
	};
	return updateArtworkDesign(
		design,
		{
			background: {
				kind: "gradient",
				value: `linear-gradient(135deg,#111827,${variant.accentColor})`,
			},
			layers: [...existingImages, shape, headline],
		},
		"Apply local AI suggestion",
	);
}

export function replaceArtworkDesign(
	document: AxcutDocument,
	design: ArtworkDesign,
): AxcutDocument {
	const exists = document.artworkDesigns.some((item) => item.id === design.id);
	return {
		...document,
		artworkDesigns: exists
			? document.artworkDesigns.map((item) => (item.id === design.id ? design : item))
			: [...document.artworkDesigns, design],
		project: { ...document.project, updatedAt: new Date().toISOString() },
	};
}

/**
 * Build a linked project whose first clip is a rendered artwork card. The source
 * document is cloned and all original media/modifiers keep their identity. Nothing
 * in the source project is mutated.
 */
export function buildOpeningCardVariantDocument(
	source: AxcutDocument,
	project: AxcutDocument["project"],
	openingAsset: AxcutAsset,
	durationSec: number,
	designId: string,
): AxcutDocument {
	const duration = Math.max(0.5, Math.min(10, durationSec));
	const original = structuredClone(source);
	const openingClip = {
		id: createId("clip"),
		assetId: openingAsset.id,
		sourceStartSec: 0,
		sourceEndSec: duration,
		timelineStartSec: 0,
		timelineEndSec: duration,
		wordRefs: [],
		origin: "user" as const,
		reason: "Artwork opening card",
	};
	const clips = resequenceClips([openingClip, ...original.timeline.clips]);
	const shiftRanges = <T extends { startSec: number; endSec: number }>(ranges: T[]): T[] =>
		ranges.map((range) => ({
			...range,
			startSec: range.startSec + duration,
			endSec: range.endSec + duration,
		}));
	const shifted: AxcutDocument = {
		...original,
		project: {
			...project,
			primaryAssetId: original.project.primaryAssetId ?? openingAsset.id,
		},
		assets: [...original.assets, openingAsset],
		timeline: {
			...original.timeline,
			clips,
			gaps: original.timeline.gaps.map((gap) => ({
				...gap,
				timelineStartSec: gap.timelineStartSec + duration,
				timelineEndSec: gap.timelineEndSec + duration,
			})),
			muteRanges: shiftRanges(original.timeline.muteRanges),
			speedRanges: shiftRanges(original.timeline.speedRanges),
			captionRanges: shiftRanges(original.timeline.captionRanges),
		},
		legacyEditor: {
			...((original.legacyEditor as Record<string, unknown> | null) ?? {}),
			creatorVariant: {
				sourceProjectId: source.project.id,
				kind: "artwork-opening-card",
				designId,
				durationSec: duration,
			},
		},
	};
	return rederiveRegionMs(shifted, clips);
}

export function contrastRatio(foreground: string, background: string): number | null {
	const parse = (value: string) => {
		const hex = value.match(/^#([0-9a-f]{6})/i)?.[1];
		if (!hex) return null;
		return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
	};
	const luminance = (rgb: number[]) => {
		const linear = rgb.map((channel) =>
			channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
		);
		return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
	};
	const foregroundRgb = parse(foreground);
	const backgroundRgb = parse(background);
	if (!foregroundRgb || !backgroundRgb) return null;
	const first = luminance(foregroundRgb);
	const second = luminance(backgroundRgb);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function artworkTextWarnings(design: ArtworkDesign): string[] {
	const warnings: string[] = [];
	for (const layer of design.layers) {
		if (layer.type !== "text") continue;
		const estimatedCharactersPerLine = Math.max(1, layer.width / (layer.fontSize * 0.58));
		const estimatedLines = Math.ceil(layer.text.length / estimatedCharactersPerLine);
		if (estimatedLines * layer.fontSize * 1.15 > layer.height) {
			warnings.push(`${layer.name} may overflow its text box.`);
		}
		if (design.background.kind === "solid") {
			const ratio = contrastRatio(layer.color, design.background.value);
			if (ratio !== null && ratio < 4.5) warnings.push(`${layer.name} has low text contrast.`);
		}
	}
	return warnings;
}
