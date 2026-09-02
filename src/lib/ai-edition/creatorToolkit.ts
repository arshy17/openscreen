import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { getCaptionSettings, patchCaptionSettings } from "./captions";
import { applyCreatorTheme, type CreatorThemeId, getCreatorTheme } from "./creatorEdit";
import { createId } from "./document/ids";
import { removeClip, resolvePlaybackSegments, setClipSourceRange } from "./document/timeline";
import type { AxcutAnnotationRegion, AxcutDocument, AxcutTrimRange } from "./schema";
import {
	type AudioEnhancementPreset,
	type AudioMasteringTarget,
	type EditorSettingsSnapshot,
	getEditorSettings,
	patchEditorSettings,
} from "./store/editorSettings";
import { anchorRegionsWithDerivedMs } from "./timeline/timelineMap";

/** Optional, local Creator Toolkit state stored inside the passthrough legacy envelope. */
export interface AudioEnhancementSettings {
	enabled: boolean;
	preset: AudioEnhancementPreset;
	intensity: number;
	noiseReductionStrength: number;
	masteringTarget: AudioMasteringTarget;
	limiterEnabled: boolean;
	limiterCeilingDb: number;
	musicDuckingEnabled: boolean;
	musicDuckingAmountDb: number;
}

export const DEFAULT_AUDIO_ENHANCEMENT: AudioEnhancementSettings = {
	enabled: false,
	preset: "clarity",
	intensity: 0.5,
	noiseReductionStrength: 0,
	masteringTarget: "off",
	limiterEnabled: false,
	limiterCeilingDb: -1,
	musicDuckingEnabled: false,
	musicDuckingAmountDb: 9,
};

export function getAudioEnhancement(
	document: AxcutDocument | null | undefined,
): AudioEnhancementSettings {
	const settings = getEditorSettings(document);
	return {
		enabled: settings.audioEnhancementEnabled,
		preset: settings.audioEnhancementPreset,
		intensity: settings.audioEnhancementIntensity,
		noiseReductionStrength: settings.audioNoiseReductionStrength,
		masteringTarget: settings.audioMasteringTarget,
		limiterEnabled: settings.audioLimiterEnabled,
		limiterCeilingDb: settings.audioLimiterCeilingDb,
		musicDuckingEnabled: settings.backgroundMusicDuckingEnabled,
		musicDuckingAmountDb: settings.backgroundMusicDuckingAmountDb,
	};
}

export function patchAudioEnhancement(
	document: AxcutDocument,
	patch: Partial<AudioEnhancementSettings>,
): AxcutDocument {
	const next = {
		...getAudioEnhancement(document),
		...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
	} as AudioEnhancementSettings;
	next.intensity = Math.min(1, Math.max(0, next.intensity));
	next.noiseReductionStrength = Math.min(1, Math.max(0, next.noiseReductionStrength));
	next.limiterCeilingDb = Math.min(-0.1, Math.max(-6, next.limiterCeilingDb));
	next.musicDuckingAmountDb = Math.min(24, Math.max(0, next.musicDuckingAmountDb));
	return patchEditorSettings(document, {
		audioEnhancementEnabled: next.enabled,
		audioEnhancementPreset: next.preset,
		audioEnhancementIntensity: next.intensity,
		audioNoiseReductionStrength: next.noiseReductionStrength,
		audioMasteringTarget: next.masteringTarget,
		audioLimiterEnabled: next.limiterEnabled,
		audioLimiterCeilingDb: next.limiterCeilingDb,
		backgroundMusicDuckingEnabled: next.musicDuckingEnabled,
		backgroundMusicDuckingAmountDb: next.musicDuckingAmountDb,
	});
}

export interface CreatorTemplate {
	id: string;
	name: string;
	createdAt: string;
	editor: EditorSettingsSnapshot;
	captions: ReturnType<typeof getCaptionSettings>;
	audioEnhancement: AudioEnhancementSettings;
}

const TEMPLATE_STORAGE_KEY = "openscreen.creator-templates.v1";

export interface BrandKit {
	id: string;
	name: string;
	createdAt: string;
	primaryColor: string;
	secondaryColor: string;
	textColor: string;
	fontFamily: string;
	logoPath: string;
	lowerThirdText: string;
	introText: string;
	outroText: string;
}

const BRAND_KIT_STORAGE_KEY = "openscreen.brand-kits.v1";

export function captureBrandKit(
	document: AxcutDocument,
	input: Pick<
		BrandKit,
		| "name"
		| "primaryColor"
		| "secondaryColor"
		| "textColor"
		| "fontFamily"
		| "logoPath"
		| "lowerThirdText"
		| "introText"
		| "outroText"
	>,
): BrandKit {
	const captions = getCaptionSettings(
		document,
		getAspectRatioValue(getEditorSettings(document).aspectRatio),
	);
	const validColor = (value: string, fallback: string) =>
		/^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
	return {
		id: createId("brand"),
		name: input.name.trim() || "My brand",
		createdAt: new Date().toISOString(),
		primaryColor: validColor(input.primaryColor, "#10b981"),
		secondaryColor: validColor(input.secondaryColor, "#0f766e"),
		textColor: validColor(input.textColor, "#ffffff"),
		fontFamily: input.fontFamily.trim().slice(0, 80) || captions.fontFamily || "Inter",
		logoPath: input.logoPath.trim(),
		lowerThirdText: input.lowerThirdText.trim(),
		introText: input.introText.trim(),
		outroText: input.outroText.trim(),
	};
}

export function applyBrandKit(document: AxcutDocument, kit: BrandKit): AxcutDocument {
	const aspectRatio = getAspectRatioValue(getEditorSettings(document).aspectRatio);
	let next = patchEditorSettings(document, {
		wallpaper: `linear-gradient(145deg, ${kit.primaryColor} 0%, ${kit.secondaryColor} 100%)`,
	});
	next = patchCaptionSettings(
		next,
		{
			fontFamily: kit.fontFamily,
			color: kit.textColor,
			backgroundColor: kit.primaryColor,
		},
		aspectRatio,
	);
	const totalMs = Math.max(0, (document.timeline.clips.at(-1)?.timelineEndSec ?? 0) * 1000);
	if (totalMs <= 0) return next;
	const additions: AxcutAnnotationRegion[] = [];
	if (kit.logoPath) {
		additions.push({
			id: createId("brand-logo"),
			startMs: 0,
			endMs: totalMs,
			type: "image",
			content: kit.name,
			position: { x: 84, y: 4 },
			size: { width: 12, height: 12 },
			style: defaultAnnotationStyle(kit.primaryColor, kit.textColor, kit.fontFamily),
			zIndex: document.annotations.length + additions.length + 1,
			imageContent: kit.logoPath,
		});
	}
	if (kit.lowerThirdText) {
		additions.push({
			id: createId("brand-lower-third"),
			startMs: 0,
			endMs: Math.min(totalMs, 6_000),
			type: "text",
			content: kit.lowerThirdText,
			position: { x: 5, y: 78 },
			size: { width: 48, height: 12 },
			style: defaultAnnotationStyle(kit.primaryColor, kit.textColor, kit.fontFamily),
			zIndex: document.annotations.length + additions.length + 1,
		});
	}
	if (kit.introText) {
		additions.push({
			id: createId("brand-intro"),
			startMs: 0,
			endMs: Math.min(totalMs, 2_500),
			type: "text",
			content: kit.introText,
			position: { x: 10, y: 34 },
			size: { width: 80, height: 24 },
			style: centeredCardStyle(kit.primaryColor, kit.textColor, kit.fontFamily),
			zIndex: document.annotations.length + additions.length + 1,
		});
	}
	if (kit.outroText) {
		additions.push({
			id: createId("brand-outro"),
			startMs: Math.max(0, totalMs - 2_500),
			endMs: totalMs,
			type: "text",
			content: kit.outroText,
			position: { x: 10, y: 34 },
			size: { width: 80, height: 24 },
			style: centeredCardStyle(kit.primaryColor, kit.textColor, kit.fontFamily),
			zIndex: document.annotations.length + additions.length + 1,
		});
	}
	const anchored = anchorRegionsWithDerivedMs(additions, document.timeline.clips, () =>
		createId("brand"),
	) as AxcutAnnotationRegion[];
	next = { ...next, annotations: [...next.annotations, ...anchored] };
	return next;
}

export function loadBrandKits(storage: Pick<Storage, "getItem">): BrandKit[] {
	try {
		const raw = storage.getItem(BRAND_KIT_STORAGE_KEY);
		if (!raw) return [];
		const values = JSON.parse(raw) as unknown;
		if (!Array.isArray(values)) return [];
		return values
			.filter(
				(value): value is BrandKit =>
					Boolean(value) &&
					typeof value === "object" &&
					typeof (value as BrandKit).id === "string" &&
					typeof (value as BrandKit).name === "string" &&
					typeof (value as BrandKit).primaryColor === "string",
			)
			.map((value) => ({
				...value,
				secondaryColor:
					typeof value.secondaryColor === "string" ? value.secondaryColor : value.primaryColor,
				textColor: typeof value.textColor === "string" ? value.textColor : "#ffffff",
				fontFamily: typeof value.fontFamily === "string" ? value.fontFamily : "Inter",
				logoPath: typeof value.logoPath === "string" ? value.logoPath : "",
				lowerThirdText: typeof value.lowerThirdText === "string" ? value.lowerThirdText : "",
				introText: typeof value.introText === "string" ? value.introText : "",
				outroText: typeof value.outroText === "string" ? value.outroText : "",
			}));
	} catch {
		return [];
	}
}

export function saveBrandKits(storage: Pick<Storage, "setItem">, kits: BrandKit[]): void {
	storage.setItem(BRAND_KIT_STORAGE_KEY, JSON.stringify(kits.slice(0, 12)));
}

function defaultAnnotationStyle(primaryColor: string, textColor: string, fontFamily: string) {
	return {
		color: textColor,
		backgroundColor: primaryColor,
		fontSize: 30,
		fontFamily,
		fontWeight: "bold" as const,
		fontStyle: "normal" as const,
		textDecoration: "none" as const,
		textAlign: "left" as const,
	};
}

function centeredCardStyle(primaryColor: string, textColor: string, fontFamily: string) {
	return {
		...defaultAnnotationStyle(primaryColor, textColor, fontFamily),
		fontSize: 48,
		textAlign: "center" as const,
	};
}

export function captureCreatorTemplate(document: AxcutDocument, name: string): CreatorTemplate {
	const editor = getEditorSettings(document);
	return {
		id: createId("template"),
		name: name.trim() || "My template",
		createdAt: new Date().toISOString(),
		editor,
		captions: getCaptionSettings(document, getAspectRatioValue(editor.aspectRatio)),
		audioEnhancement: getAudioEnhancement(document),
	};
}

export function applyCreatorTemplate(
	document: AxcutDocument,
	template: CreatorTemplate,
): AxcutDocument {
	let next = patchEditorSettings(document, {
		...template.editor,
		cursor: {
			...template.editor.cursor,
			theme: template.editor.cursorTheme,
			show: template.editor.cursorShow,
		},
	});
	next = patchCaptionSettings(
		next,
		template.captions,
		getAspectRatioValue(template.editor.aspectRatio),
	);
	return patchAudioEnhancement(next, template.audioEnhancement);
}

export function loadCreatorTemplates(storage: Pick<Storage, "getItem">): CreatorTemplate[] {
	try {
		const raw = storage.getItem(TEMPLATE_STORAGE_KEY);
		if (!raw) return [];
		const values = JSON.parse(raw) as unknown;
		if (!Array.isArray(values)) return [];
		return values.filter((value): value is CreatorTemplate =>
			Boolean(
				value &&
					typeof value === "object" &&
					typeof (value as CreatorTemplate).id === "string" &&
					typeof (value as CreatorTemplate).name === "string" &&
					(value as CreatorTemplate).editor &&
					(value as CreatorTemplate).captions,
			),
		);
	} catch {
		return [];
	}
}

export function saveCreatorTemplates(
	storage: Pick<Storage, "setItem">,
	templates: CreatorTemplate[],
): void {
	storage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates.slice(0, 24)));
}

export interface PlannedTrim {
	id: string;
	clipId: string;
	assetId: string;
	startSec: number;
	endSec: number;
	reason: string;
	durationSec: number;
	confidence: number;
	evidence: string;
	risk: "low" | "medium";
}

export interface CreatorEditPlan {
	sourceRevision: number;
	themeId: CreatorThemeId;
	currentDurationSec: number;
	estimatedDurationSec: number;
	trimSuggestions: PlannedTrim[];
	hasTranscript: boolean;
	hasCamera: boolean;
}

function durationAfterExistingTrims(document: AxcutDocument): number {
	return resolvePlaybackSegments(document.timeline.clips, document.timeline.trimRanges).reduce(
		(sum, clip) => sum + Math.max(0, clip.timelineEndSec - clip.timelineStartSec),
		0,
	);
}

function overlapsExistingTrim(
	document: AxcutDocument,
	clipId: string,
	startSec: number,
	endSec: number,
): boolean {
	return document.timeline.trimRanges.some(
		(trim) =>
			(trim.clipId == null || trim.clipId === clipId) &&
			trim.endSec > startSec &&
			trim.startSec < endSec,
	);
}

/**
 * Build a reviewable plan without changing the document or calling a model.
 * Only explicit transcript silence is proposed here; semantic cuts stay behind
 * the separately-labelled AI refinement option.
 */
export function buildCreatorEditPlan(
	document: AxcutDocument,
	themeId: CreatorThemeId,
	sourceRevision: number,
): CreatorEditPlan {
	const suggestions: PlannedTrim[] = [];
	for (const clip of [...document.timeline.clips].sort(
		(a, b) => a.timelineStartSec - b.timelineStartSec,
	)) {
		const transcript = document.transcripts.find((item) => item.assetId === clip.assetId);
		if (!transcript) continue;
		const clipEnd = clip.sourceEndSec ?? Number.POSITIVE_INFINITY;
		for (const segment of transcript.segments) {
			if (segment.kind !== "silence" || segment.endSec - segment.startSec < 1.1) continue;
			const startSec = Math.max(clip.sourceStartSec, segment.startSec + 0.12);
			const endSec = Math.min(clipEnd, segment.endSec - 0.12);
			if (endSec - startSec < 0.65) continue;
			if (overlapsExistingTrim(document, clip.id, startSec, endSec)) continue;
			suggestions.push({
				id: createId("plantrim"),
				clipId: clip.id,
				assetId: clip.assetId,
				startSec,
				endSec,
				durationSec: endSec - startSec,
				reason: "Explicit transcript silence",
				confidence: Math.min(0.99, 0.86 + Math.min(0.12, (endSec - startSec) / 20)),
				evidence: `Transcript marked ${Math.round((segment.endSec - segment.startSec) * 10) / 10}s as silence; 120ms handles are preserved on each side.`,
				risk: endSec - startSec >= 2 ? "low" : "medium",
			});
		}
	}
	const selected = suggestions.sort((a, b) => b.durationSec - a.durationSec).slice(0, 8);
	const currentDurationSec = durationAfterExistingTrims(document);
	return {
		sourceRevision,
		themeId,
		currentDurationSec,
		estimatedDurationSec: Math.max(
			0,
			currentDurationSec - selected.reduce((sum, item) => sum + item.durationSec, 0),
		),
		trimSuggestions: selected,
		hasTranscript: document.transcripts.some((item) => item.words.length > 0),
		hasCamera: document.assets.some((asset) => Boolean(asset.cameraTrack?.sourcePath)),
	};
}

export interface ApplyCreatorPlanSelection {
	currentRevision: number;
	style: boolean;
	visuals: boolean;
	trimIds: string[];
}

export function applyCreatorEditPlan(
	document: AxcutDocument,
	plan: CreatorEditPlan,
	selection: ApplyCreatorPlanSelection,
): AxcutDocument {
	if (selection.currentRevision !== plan.sourceRevision) {
		throw new Error(
			"This proposal is stale because the project changed after analysis. Review a refreshed plan before applying it.",
		);
	}
	let next = document;
	if (selection.style) {
		next = applyCreatorTheme(next, plan.themeId, { visuals: selection.visuals }).document;
	}
	const chosen = new Set(selection.trimIds);
	const newTrims: AxcutTrimRange[] = plan.trimSuggestions
		.filter((item) => chosen.has(item.id))
		.map((item) => ({
			id: createId("trim"),
			assetId: item.assetId,
			clipId: item.clipId,
			startSec: item.startSec,
			endSec: item.endSec,
			reason: item.reason,
			origin: "user",
		}));
	if (newTrims.length === 0) return next;
	return {
		...next,
		timeline: { ...next.timeline, trimRanges: [...next.timeline.trimRanges, ...newTrims] },
	};
}

export interface ClipSuggestion {
	id: string;
	clipId: string;
	assetId: string;
	startSec: number;
	endSec: number;
	durationSec: number;
	title: string;
	previewText: string;
	score: number;
}

const HOOK_WORDS =
	/\b(how|why|best|important|secret|mistake|tip|first|finally|result|before|after)\b/i;

/** Suggest self-contained source windows; creating one is always a separate project. */
export function suggestClips(document: AxcutDocument, targetSec: 15 | 30 | 60): ClipSuggestion[] {
	const candidates: ClipSuggestion[] = [];
	for (const clip of document.timeline.clips) {
		const transcript = document.transcripts.find((item) => item.assetId === clip.assetId);
		if (!transcript) continue;
		const speech = transcript.segments.filter(
			(segment) =>
				segment.kind === "speech" &&
				segment.endSec > clip.sourceStartSec &&
				segment.startSec < (clip.sourceEndSec ?? Number.POSITIVE_INFINITY),
		);
		for (let index = 0; index < speech.length; index += 1) {
			const startSec = Math.max(clip.sourceStartSec, speech[index].startSec);
			const hardEnd = Math.min(clip.sourceEndSec ?? startSec + targetSec, startSec + targetSec);
			const included = speech.filter(
				(segment) => segment.endSec > startSec && segment.startSec < hardEnd,
			);
			if (included.length === 0) continue;
			const endSec = Math.min(hardEnd, included.at(-1)?.endSec ?? hardEnd);
			if (endSec - startSec < Math.min(6, targetSec * 0.45)) continue;
			const previewText = included
				.map((segment) => segment.text.trim())
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();
			const wordCount = previewText.split(/\s+/).filter(Boolean).length;
			const score =
				(HOOK_WORDS.test(previewText) ? 30 : 0) + Math.min(40, wordCount) + Math.max(0, 20 - index);
			candidates.push({
				id: createId("clipidea"),
				clipId: clip.id,
				assetId: clip.assetId,
				startSec,
				endSec,
				durationSec: endSec - startSec,
				title: previewText.split(/(?<=[.!?])\s/)[0]?.slice(0, 64) || "Suggested clip",
				previewText: previewText.slice(0, 220),
				score,
			});
		}
	}
	return candidates
		.sort((a, b) => b.score - a.score)
		.filter(
			(candidate, index, all) =>
				all.findIndex(
					(other) =>
						other.clipId === candidate.clipId &&
						Math.abs(other.startSec - candidate.startSec) < targetSec * 0.5,
				) === index,
		)
		.slice(0, 3);
}

export function buildClipVariantDocument(
	source: AxcutDocument,
	project: AxcutDocument["project"],
	suggestion: ClipSuggestion,
): AxcutDocument {
	let next: AxcutDocument = { ...structuredClone(source), project };
	for (const clip of [...next.timeline.clips]) {
		if (clip.id !== suggestion.clipId) next = removeClip(next, clip.id);
	}
	next = setClipSourceRange(next, suggestion.clipId, suggestion.startSec, suggestion.endSec);
	return {
		...next,
		project: { ...project, primaryAssetId: suggestion.assetId },
		legacyEditor: {
			...((next.legacyEditor as Record<string, unknown> | null) ?? {}),
			creatorVariant: { sourceProjectId: source.project.id, kind: "clip" },
		},
	};
}

export function buildSocialVariantDocument(
	source: AxcutDocument,
	project: AxcutDocument["project"],
	themeId: CreatorThemeId,
	includeVisuals: boolean,
): AxcutDocument {
	const themed = applyCreatorTheme({ ...structuredClone(source), project }, themeId, {
		visuals: includeVisuals,
	}).document;
	return {
		...themed,
		project,
		legacyEditor: {
			...((themed.legacyEditor as Record<string, unknown> | null) ?? {}),
			creatorVariant: {
				sourceProjectId: source.project.id,
				kind: "social",
				themeId,
			},
		},
	};
}

export type LayoutRecipe = "screen-first" | "camera-hook" | "camera-pulse";

export function applyLayoutRecipe(document: AxcutDocument, recipe: LayoutRecipe): AxcutDocument {
	const legacy = (document.legacyEditor as Record<string, unknown> | null) ?? {};
	const totalMs = Math.max(0, (document.timeline.clips.at(-1)?.timelineEndSec ?? 0) * 1000);
	if (recipe === "screen-first" || totalMs <= 0) {
		return { ...document, legacyEditor: { ...legacy, cameraFullscreenRegions: [] } };
	}
	const raw =
		recipe === "camera-hook"
			? [{ id: createId("camfull"), startMs: 0, endMs: Math.min(totalMs, 3500) }]
			: Array.from({ length: Math.ceil(totalMs / 18_000) }, (_, index) => ({
					id: createId("camfull"),
					startMs: index * 18_000,
					endMs: Math.min(totalMs, index * 18_000 + 2600),
				}));
	const cameraFullscreenRegions = anchorRegionsWithDerivedMs(raw, document.timeline.clips, () =>
		createId("camfull"),
	);
	return {
		...document,
		legacyEditor: { ...legacy, cameraFullscreenRegions },
	};
}

export interface PrivacyFinding {
	id: string;
	type: "email" | "phone" | "credential";
	assetId: string;
	startSec: number;
	endSec: number;
	preview: string;
}

const PRIVACY_PATTERNS: Array<{
	type: PrivacyFinding["type"];
	pattern: RegExp;
}> = [
	{ type: "email", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
	{ type: "phone", pattern: /(?:\+?\d[\d\s().-]{7,}\d)/ },
	{
		type: "credential",
		pattern: /\b(?:api[_ -]?key|password|secret|access[_ -]?token|private[_ -]?key)\b/i,
	},
];

/** Local-only transcript scan. It never masks or uploads anything by itself. */
export function scanPrivacy(document: AxcutDocument): PrivacyFinding[] {
	return document.transcripts.flatMap((transcript) =>
		transcript.segments.flatMap((segment) => {
			const match = PRIVACY_PATTERNS.find(({ pattern }) => pattern.test(segment.text));
			return match
				? [
						{
							id: createId("privacy"),
							type: match.type,
							assetId: transcript.assetId,
							startSec: segment.startSec,
							endSec: segment.endSec,
							preview: segment.text.trim().slice(0, 120),
						},
					]
				: [];
		}),
	);
}

export type PrivacyMaskPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const MASK_POSITIONS: Record<PrivacyMaskPosition, { x: number; y: number }> = {
	"top-left": { x: 2, y: 3 },
	"top-right": { x: 73, y: 3 },
	"bottom-left": { x: 2, y: 82 },
	"bottom-right": { x: 73, y: 82 },
};

export function applyPrivacyMask(
	document: AxcutDocument,
	position: PrivacyMaskPosition,
): AxcutDocument {
	const totalMs = Math.max(0, (document.timeline.clips.at(-1)?.timelineEndSec ?? 0) * 1000);
	if (totalMs <= 0) return document;
	const base: AxcutAnnotationRegion = {
		id: createId("privacy-mask"),
		startMs: 0,
		endMs: totalMs,
		type: "blur",
		content: "Privacy mask",
		position: MASK_POSITIONS[position],
		size: { width: 25, height: 15 },
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
		zIndex: document.annotations.length + 1,
		blurData: {
			type: "mosaic",
			shape: "rectangle",
			color: "black",
			intensity: 18,
			blockSize: 18,
		},
	};
	const masks = anchorRegionsWithDerivedMs([base], document.timeline.clips, () =>
		createId("privacy-mask"),
	) as AxcutAnnotationRegion[];
	return { ...document, annotations: [...document.annotations, ...masks] };
}

export interface TrackedPrivacyMaskOptions {
	startSec: number;
	endSec: number;
	from: PrivacyMaskPosition;
	to: PrivacyMaskPosition;
	steps?: number;
}

/**
 * Build a reviewable cross-platform tracked mask from ordinary annotation
 * regions. The compositor does not need a platform-specific tracker: each
 * short region is editable, and linear interpolation keeps the target covered
 * while it moves between the two user-confirmed positions.
 */
export function applyTrackedPrivacyMask(
	document: AxcutDocument,
	options: TrackedPrivacyMaskOptions,
): AxcutDocument {
	const durationSec = Math.max(0, options.endSec - options.startSec);
	if (durationSec <= 0) return document;
	const stepCount = Math.min(48, Math.max(2, Math.round(options.steps ?? durationSec * 2)));
	const from = MASK_POSITIONS[options.from];
	const to = MASK_POSITIONS[options.to];
	const raw = Array.from({ length: stepCount }, (_, index) => {
		const progress = stepCount === 1 ? 0 : index / (stepCount - 1);
		const startMs = (options.startSec + (durationSec * index) / stepCount) * 1000;
		const endMs = (options.startSec + (durationSec * (index + 1)) / stepCount) * 1000;
		return {
			id: createId("privacy-track"),
			startMs,
			endMs,
			type: "blur" as const,
			content: "Tracked privacy mask",
			position: {
				x: from.x + (to.x - from.x) * progress,
				y: from.y + (to.y - from.y) * progress,
			},
			size: { width: 25, height: 15 },
			style: {
				color: "#ffffff",
				backgroundColor: "transparent",
				fontSize: 32,
				fontFamily: "Inter",
				fontWeight: "bold" as const,
				fontStyle: "normal" as const,
				textDecoration: "none" as const,
				textAlign: "center" as const,
			},
			zIndex: document.annotations.length + index + 1,
			blurData: {
				type: "mosaic" as const,
				shape: "rectangle" as const,
				color: "black",
				intensity: 18,
				blockSize: 18,
			},
		};
	});
	const masks = anchorRegionsWithDerivedMs(raw, document.timeline.clips, () =>
		createId("privacy-track"),
	) as AxcutAnnotationRegion[];
	return { ...document, annotations: [...document.annotations, ...masks] };
}

export interface ProjectPerformanceAssessment {
	level: "healthy" | "watch" | "heavy";
	durationSec: number;
	editCount: number;
	captionWordCount: number;
	recommendations: string[];
}

/** Deterministic complexity budget shown before a project becomes unpleasant to edit. */
export function assessProjectPerformance(document: AxcutDocument): ProjectPerformanceAssessment {
	const durationSec = durationAfterExistingTrims(document);
	const editCount =
		document.timeline.clips.length +
		document.timeline.trimRanges.length +
		document.annotations.length +
		document.zoomRanges.length;
	const captionWordCount = document.transcripts.reduce((sum, item) => sum + item.words.length, 0);
	const recommendations: string[] = [];
	if (durationSec > 3_600)
		recommendations.push("Split projects longer than one hour before dense editing.");
	if (editCount > 1_500)
		recommendations.push("Archive or consolidate old annotations and micro-cuts.");
	if (captionWordCount > 18_000)
		recommendations.push("Keep captions in sentence-sized chunks for smoother preview.");
	const score =
		Number(durationSec > 3_600) + Number(editCount > 1_500) + Number(captionWordCount > 18_000);
	return {
		level: score >= 2 ? "heavy" : score === 1 ? "watch" : "healthy",
		durationSec,
		editCount,
		captionWordCount,
		recommendations,
	};
}

export function creatorToolkitSummary(document: AxcutDocument): {
	durationSec: number;
	transcriptWords: number;
	hasCamera: boolean;
	hasAudio: boolean;
} {
	return {
		durationSec: durationAfterExistingTrims(document),
		transcriptWords: document.transcripts.reduce((sum, item) => sum + item.words.length, 0),
		hasCamera: document.assets.some((asset) => Boolean(asset.cameraTrack?.sourcePath)),
		hasAudio: document.assets.some((asset) => Boolean(asset.audio?.channels)),
	};
}

export function creatorThemeLabel(themeId: CreatorThemeId): string {
	return getCreatorTheme(themeId).label;
}
