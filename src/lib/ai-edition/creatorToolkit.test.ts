import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "./captions";
import {
	applyBrandKit,
	applyCreatorEditPlan,
	applyCreatorTemplate,
	applyLayoutRecipe,
	applyPrivacyMask,
	applyTrackedPrivacyMask,
	assessProjectPerformance,
	buildClipVariantDocument,
	buildCreatorEditPlan,
	buildSocialVariantDocument,
	captureBrandKit,
	captureCreatorTemplate,
	getAudioEnhancement,
	loadBrandKits,
	loadCreatorTemplates,
	patchAudioEnhancement,
	saveBrandKits,
	saveCreatorTemplates,
	scanPrivacy,
	suggestClips,
} from "./creatorToolkit";
import { type AxcutDocument, createEmptyDocument, documentSchema } from "./schema";
import { getEditorSettings, patchEditorSettings } from "./store/editorSettings";

function fixture(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "source",
		title: "Source",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "source.mp4",
				originalPath: "/tmp/source.mp4",
				durationSec: 80,
				audio: { codec: "aac", sampleRate: 48_000, channels: 2 },
				cameraTrack: { sourcePath: "/tmp/camera.mp4", startMs: 0, offsetMs: 0, visible: true },
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "s1",
						kind: "speech",
						startSec: 0,
						endSec: 8,
						text: "Here is the best first tip",
						wordIds: ["w1"],
					},
					{ id: "s2", kind: "silence", startSec: 8, endSec: 10, text: "", wordIds: [] },
					{
						id: "s3",
						kind: "speech",
						startSec: 10,
						endSec: 22,
						text: "Contact me at hello@example.com for the result",
						wordIds: ["w2"],
					},
					{ id: "s4", kind: "silence", startSec: 22, endSec: 24, text: "", wordIds: [] },
					{
						id: "s5",
						kind: "speech",
						startSec: 24,
						endSec: 55,
						text: "Why this workflow matters and how it works",
						wordIds: ["w3"],
					},
				],
				words: [
					{ id: "w1", segmentId: "s1", startSec: 0, endSec: 1, text: "best" },
					{ id: "w2", segmentId: "s3", startSec: 10, endSec: 11, text: "contact" },
					{ id: "w3", segmentId: "s5", startSec: 24, endSec: 25, text: "why" },
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
					sourceEndSec: 60,
					timelineStartSec: 0,
					timelineEndSec: 60,
					wordRefs: ["w1", "w2", "w3"],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

describe("Creator Toolkit", () => {
	it("builds a no-write edit plan and applies only selected parts", () => {
		const source = fixture();
		const plan = buildCreatorEditPlan(source, "social-punch", 7);
		expect(source.timeline.trimRanges).toEqual([]);
		expect(plan.trimSuggestions).toHaveLength(2);
		expect(plan.trimSuggestions[0]).toMatchObject({ risk: "medium" });
		expect(plan.trimSuggestions[0].confidence).toBeGreaterThan(0.85);
		expect(plan.trimSuggestions[0].evidence).toContain("handles");
		const next = applyCreatorEditPlan(source, plan, {
			currentRevision: 7,
			style: true,
			visuals: false,
			trimIds: [plan.trimSuggestions[0].id],
		});
		expect(next.timeline.trimRanges).toHaveLength(1);
		expect(next.annotations).toEqual([]);
		expect(getEditorSettings(next).aspectRatio).toBe("9:16");
	});

	it("rejects a stale review plan before any document write", () => {
		const source = fixture();
		const plan = buildCreatorEditPlan(source, "social-punch", 3);
		expect(() =>
			applyCreatorEditPlan(source, plan, {
				currentRevision: 4,
				style: true,
				visuals: true,
				trimIds: plan.trimSuggestions.map((item) => item.id),
			}),
		).toThrow(/stale/i);
		expect(source.timeline.trimRanges).toEqual([]);
		expect(source.annotations).toEqual([]);
	});

	it("creates bounded, editable tracked privacy regions", () => {
		const masked = applyTrackedPrivacyMask(fixture(), {
			startSec: 2,
			endSec: 8,
			from: "top-left",
			to: "bottom-right",
			steps: 6,
		});
		expect(masked.annotations).toHaveLength(6);
		expect(masked.annotations[0]).toMatchObject({ position: { x: 2, y: 3 } });
		expect(masked.annotations.at(-1)?.position.x).toBeCloseTo(73);
		expect(masked.annotations.at(-1)?.position.y).toBeCloseTo(82);
		expect(masked.annotations.every((item) => item.type === "blur")).toBe(true);
	});

	it("reports project complexity without changing the document", () => {
		const source = fixture();
		const assessment = assessProjectPerformance(source);
		expect(assessment).toMatchObject({ level: "healthy", durationSec: 60 });
		expect(source.annotations).toEqual([]);
	});

	it("saves and reapplies a custom template without touching timeline content", () => {
		let source = patchEditorSettings(fixture(), { aspectRatio: "4:5", padding: 24 });
		source = patchAudioEnhancement(source, { enabled: true, preset: "podcast", intensity: 0.7 });
		const template = captureCreatorTemplate(source, "  My brand  ");
		const storage = new Map<string, string>();
		const adapter = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		};
		saveCreatorTemplates(adapter, [template]);
		expect(loadCreatorTemplates(adapter)[0].name).toBe("My brand");
		const applied = applyCreatorTemplate(fixture(), template);
		expect(getEditorSettings(applied)).toMatchObject({ aspectRatio: "4:5", padding: 24 });
		expect(getAudioEnhancement(applied)).toMatchObject({ enabled: true, preset: "podcast" });
		expect(applied.timeline.clips).toEqual(fixture().timeline.clips);
	});

	it("stores and applies an optional brand kit as editable caption/logo/lower-third data", () => {
		const source = fixture();
		const kit = captureBrandKit(source, {
			name: "Northstar",
			primaryColor: "#123456",
			secondaryColor: "#654321",
			textColor: "#fefefe",
			fontFamily: "Atkinson Hyperlegible",
			logoPath: "/tmp/logo.png",
			lowerThirdText: "Arshia · Founder",
			introText: "Welcome",
			outroText: "Follow for more",
		});
		const storage = new Map<string, string>();
		const adapter = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		};
		saveBrandKits(adapter, [kit]);
		expect(loadBrandKits(adapter)[0]).toMatchObject({ name: "Northstar" });
		const applied = applyBrandKit(source, kit);
		expect(applied.annotations).toHaveLength(4);
		expect(applied.annotations.map((item) => item.content)).toEqual([
			"Northstar",
			"Arshia · Founder",
			"Welcome",
			"Follow for more",
		]);
		expect(getCaptionSettings(applied)).toMatchObject({
			color: "#fefefe",
			backgroundColor: "#123456",
			fontFamily: "Atkinson Hyperlegible",
		});
		expect(getEditorSettings(applied).wallpaper).toContain("#654321");
	});

	it("creates clips and social variants as new project documents", () => {
		const source = fixture();
		const idea = suggestClips(source, 30)[0];
		expect(idea).toBeTruthy();
		const project = { ...source.project, id: "variant", title: "Variant" };
		const clip = buildClipVariantDocument(source, project, idea);
		expect(clip.project.id).toBe("variant");
		expect(clip.timeline.clips).toHaveLength(1);
		expect(source.project.id).toBe("source");
		const social = buildSocialVariantDocument(source, project, "youtube-explainer", false);
		expect(getEditorSettings(social).aspectRatio).toBe("16:9");
		expect(social.annotations).toHaveLength(0);
	});

	it("builds optional camera scenes, privacy findings and a user-approved mask", () => {
		const source = fixture();
		const laidOut = applyLayoutRecipe(source, "camera-pulse");
		expect(
			(laidOut.legacyEditor as { cameraFullscreenRegions: unknown[] }).cameraFullscreenRegions
				.length,
		).toBeGreaterThan(1);
		expect(scanPrivacy(source)).toMatchObject([{ type: "email" }]);
		const masked = applyPrivacyMask(source, "top-right");
		expect(masked.annotations).toHaveLength(1);
		expect(masked.annotations[0]).toMatchObject({ type: "blur", position: { x: 73, y: 3 } });
	});

	it("keeps captions and audio enhancement opt-in", () => {
		const source = fixture();
		expect(getCaptionSettings(source).enabled).toBe(false);
		expect(getAudioEnhancement(source).enabled).toBe(false);
		expect(patchAudioEnhancement(source, { enabled: true }).legacyEditor).not.toEqual(
			source.legacyEditor,
		);
	});
});
