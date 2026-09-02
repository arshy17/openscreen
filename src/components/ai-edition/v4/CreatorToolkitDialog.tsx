import {
	Activity,
	ArchiveRestore,
	AudioLines,
	Check,
	Clapperboard,
	CopyPlus,
	Eye,
	LayoutTemplate,
	Loader2,
	PackageOpen,
	Palette,
	Save,
	Scissors,
	ShieldCheck,
	Sparkles,
	Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	applyCreatorTheme,
	buildCreatorEditPrompt,
	CREATOR_THEMES,
	type CreatorThemeId,
} from "@/lib/ai-edition/creatorEdit";
import {
	applyBrandKit,
	applyCreatorEditPlan,
	applyCreatorTemplate,
	applyLayoutRecipe,
	applyPrivacyMask,
	applyTrackedPrivacyMask,
	assessProjectPerformance,
	type BrandKit,
	buildClipVariantDocument,
	buildCreatorEditPlan,
	buildSocialVariantDocument,
	type CreatorTemplate,
	captureBrandKit,
	captureCreatorTemplate,
	creatorToolkitSummary,
	getAudioEnhancement,
	loadBrandKits,
	loadCreatorTemplates,
	type PrivacyMaskPosition,
	patchAudioEnhancement,
	saveBrandKits,
	saveCreatorTemplates,
	scanPrivacy,
	suggestClips,
} from "@/lib/ai-edition/creatorToolkit";
import {
	applyVisionPrivacyCandidates,
	type PrivacyVisionCandidate,
} from "@/lib/ai-edition/privacyVision";
import { getEditorSettings } from "@/lib/ai-edition/store/editorSettings";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { useChatPromptBus } from "@/lib/ai-edition/store/useChatPromptBus";
import { formatSec } from "@/lib/ai-edition/timeline/format";
import { nativeBridgeClient } from "@/native/client";
import type { AiEditionProjectSnapshotSummary } from "@/native/contracts";
import { ModalShell } from "../Modals";
import styles from "./EditorShellV4.module.css";

type ToolkitTab =
	| "plan"
	| "templates"
	| "clips"
	| "variants"
	| "layouts"
	| "privacy"
	| "audio"
	| "brand"
	| "recovery"
	| "performance";

const TABS: Array<{ id: ToolkitTab; label: string; icon: typeof Sparkles }> = [
	{ id: "plan", label: "Edit plan", icon: Sparkles },
	{ id: "templates", label: "Templates", icon: LayoutTemplate },
	{ id: "clips", label: "Make clips", icon: Scissors },
	{ id: "variants", label: "Social variants", icon: CopyPlus },
	{ id: "layouts", label: "Layouts", icon: Clapperboard },
	{ id: "privacy", label: "Privacy", icon: ShieldCheck },
	{ id: "audio", label: "Audio", icon: AudioLines },
	{ id: "brand", label: "Brand kits", icon: Palette },
	{ id: "recovery", label: "Recovery", icon: ArchiveRestore },
	{ id: "performance", label: "Performance", icon: Activity },
];

export function CreatorToolkitDialog({
	open,
	onClose,
	initialTab = "plan",
	initialThemeId = "social-punch",
}: {
	open: boolean;
	onClose: () => void;
	initialTab?: ToolkitTab;
	initialThemeId?: CreatorThemeId;
}) {
	const document = useProjectStore((state) => state.document);
	const [tab, setTab] = useState<ToolkitTab>(initialTab);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (open) setTab(initialTab);
	}, [initialTab, open]);

	return (
		<ModalShell
			open={open}
			onClose={onClose}
			title="Creator Toolkit"
			subtitle="Everything here is optional. Review first, apply only what you choose, and keep editing manually at any time."
			wide
		>
			<div className={styles.creatorToolkit}>
				<nav className={styles.creatorToolkitTabs} aria-label="Creator Toolkit sections">
					{TABS.map((item) => {
						const Icon = item.icon;
						return (
							<button
								type="button"
								key={item.id}
								className={
									tab === item.id ? styles.creatorToolkitTabActive : styles.creatorToolkitTab
								}
								onClick={() => setTab(item.id)}
							>
								<Icon size={15} />
								{item.label}
							</button>
						);
					})}
				</nav>
				<div className={styles.creatorToolkitBody}>
					{!document ? (
						<EmptyState text="Import or record a video first. Nothing will be changed until then." />
					) : tab === "plan" ? (
						<PlanPanel
							document={document}
							initialThemeId={initialThemeId}
							busy={busy}
							setBusy={setBusy}
						/>
					) : tab === "templates" ? (
						<TemplatesPanel document={document} busy={busy} setBusy={setBusy} />
					) : tab === "clips" ? (
						<ClipsPanel document={document} busy={busy} setBusy={setBusy} onCreated={onClose} />
					) : tab === "variants" ? (
						<VariantsPanel document={document} busy={busy} setBusy={setBusy} onCreated={onClose} />
					) : tab === "layouts" ? (
						<LayoutsPanel document={document} busy={busy} setBusy={setBusy} />
					) : tab === "privacy" ? (
						<PrivacyPanel document={document} busy={busy} setBusy={setBusy} />
					) : tab === "audio" ? (
						<AudioPanel document={document} busy={busy} setBusy={setBusy} />
					) : tab === "brand" ? (
						<BrandKitsPanel document={document} busy={busy} setBusy={setBusy} />
					) : tab === "recovery" ? (
						<RecoveryPanel document={document} busy={busy} setBusy={setBusy} />
					) : (
						<PerformancePanel document={document} />
					)}
				</div>
			</div>
		</ModalShell>
	);
}

function PlanPanel({
	document,
	initialThemeId,
	busy,
	setBusy,
}: PanelProps & { initialThemeId: CreatorThemeId }) {
	const [themeId, setThemeId] = useState<CreatorThemeId>(initialThemeId);
	const revision = useProjectStore((state) => state.revision);
	const plan = useMemo(
		() => buildCreatorEditPlan(document, themeId, revision),
		[document, revision, themeId],
	);
	const [style, setStyle] = useState(true);
	const [visuals, setVisuals] = useState(false);
	const [aiRefinement, setAiRefinement] = useState(false);
	const [trimIds, setTrimIds] = useState<string[]>([]);
	useEffect(() => setTrimIds(plan.trimSuggestions.map((item) => item.id)), [plan]);
	useEffect(() => {
		if (!plan.hasTranscript) setAiRefinement(false);
	}, [plan.hasTranscript]);
	const theme = CREATOR_THEMES.find((item) => item.id === themeId) ?? CREATOR_THEMES[0];
	const selectedSeconds = plan.trimSuggestions
		.filter((item) => trimIds.includes(item.id))
		.reduce((sum, item) => sum + item.durationSec, 0);

	const apply = async () => {
		setBusy(true);
		try {
			let store = useProjectStore.getState();
			if (!store.document) return;
			if (store.revision !== plan.sourceRevision) {
				throw new Error(
					"The project changed after this plan was prepared. The preview has been refreshed; review it before applying.",
				);
			}
			await nativeBridgeClient.aiEdition.createSnapshot(
				store.document.project.id,
				"Before Creator Edit",
				"ai",
			);
			store = useProjectStore.getState();
			if (!store.document) return;
			const next = applyCreatorEditPlan(store.document, plan, {
				currentRevision: store.revision,
				style,
				visuals,
				trimIds,
			});
			const saved = await store.saveDocument(next, { history: true });
			if (!saved) return;
			if (aiRefinement) {
				useChatPromptBus
					.getState()
					.submit(buildCreatorEditPrompt(themeId), "Creator Edit requested");
			}
			toast.success("Reviewed edit plan applied", {
				description: `${style ? theme.label : "Manual style kept"} · ${trimIds.length} safe cut${trimIds.length === 1 ? "" : "s"}${aiRefinement ? " · AI refinement requested" : ""}`,
			});
		} catch (error) {
			toast.error("Creator Edit was not applied", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<section>
			<PanelHeader
				title="AI Edit Plan"
				description="This is a preview, not an edit. Automatic proposals are limited to explicit transcript silences; optional AI refinement happens only after you approve the plan."
			/>
			<div className={styles.creatorToolkitMetrics}>
				<Metric label="Current" value={formatSec(plan.currentDurationSec)} />
				<Metric
					label="After selected cuts"
					value={formatSec(Math.max(0, plan.currentDurationSec - selectedSeconds))}
				/>
				<Metric label="Transcript" value={plan.hasTranscript ? "Ready" : "Not available"} />
				<Metric label="Webcam" value={plan.hasCamera ? "Available" : "Not attached"} />
			</div>
			<label className={styles.creatorToolkitField}>
				<span>Design preset</span>
				<select
					value={themeId}
					onChange={(event) => setThemeId(event.target.value as CreatorThemeId)}
				>
					{CREATOR_THEMES.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label} · {item.aspectRatio}
						</option>
					))}
				</select>
			</label>
			<div className={styles.creatorToolkitChecks}>
				<ToggleRow
					checked={style}
					onChange={setStyle}
					title="Apply design and captions"
					detail="Optional composition, fonts, colors, safe area, and camera styling."
				/>
				<ToggleRow
					checked={visuals}
					onChange={setVisuals}
					title="Add restrained built-in visuals"
					detail="Off by default. Uses only OpenScreen icons/callouts; no downloaded copyrighted media."
				/>
				<ToggleRow
					checked={aiRefinement}
					onChange={setAiRefinement}
					disabled={!plan.hasTranscript}
					title="Ask the selected AI for semantic cut refinement"
					detail="Off by default. The model receives only the bounded transcript/cut tool and never exports or publishes."
				/>
			</div>
			<div className={styles.creatorToolkitList}>
				{plan.trimSuggestions.length === 0 ? (
					<EmptyState
						text="No long transcript silences were found. You can still apply only the design or continue manually."
						compact
					/>
				) : (
					plan.trimSuggestions.map((item) => (
						<label key={item.id} className={styles.creatorToolkitListRow}>
							<input
								type="checkbox"
								checked={trimIds.includes(item.id)}
								onChange={(event) =>
									setTrimIds((current) =>
										event.target.checked
											? [...current, item.id]
											: current.filter((id) => id !== item.id),
									)
								}
							/>
							<span>
								<strong>
									{formatSec(item.startSec)}–{formatSec(item.endSec)}
								</strong>
								<small>
									{item.reason} · {Math.round(item.confidence * 100)}% confidence · saves{" "}
									{item.durationSec.toFixed(1)}s
								</small>
								<small>{item.evidence}</small>
							</span>
						</label>
					))
				)}
			</div>
			<ActionButton
				disabled={busy || (!style && trimIds.length === 0 && !aiRefinement)}
				onClick={() => void apply()}
			>
				{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Apply selected
				parts
			</ActionButton>
		</section>
	);
}

function TemplatesPanel({ document, busy, setBusy }: PanelProps) {
	const [name, setName] = useState("");
	const [includeVisuals, setIncludeVisuals] = useState(false);
	const [templates, setTemplates] = useState<CreatorTemplate[]>(() =>
		loadCreatorTemplates(localStorage),
	);
	const persist = (next: CreatorTemplate[]) => {
		setTemplates(next);
		saveCreatorTemplates(localStorage, next);
	};
	const applyDocument = async (next: typeof document, message: string) => {
		setBusy(true);
		try {
			if (await useProjectStore.getState().saveDocument(next, { history: true }))
				toast.success(message);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Ready-made and reusable templates"
				description="Built-in templates have a visible platform preview. Save your current design as a private local template and reuse it later."
			/>
			<ToggleRow
				checked={includeVisuals}
				onChange={setIncludeVisuals}
				title="Include built-in visuals when applying a preset"
				detail="Off keeps your annotations exactly as they are."
			/>
			<div className={styles.creatorTemplateGrid}>
				{CREATOR_THEMES.map((theme) => (
					<button
						key={theme.id}
						type="button"
						disabled={busy}
						className={styles.creatorTemplateCard}
						onClick={() =>
							void applyDocument(
								applyCreatorThemeSafely(document, theme.id, includeVisuals),
								`${theme.label} applied`,
							)
						}
					>
						<ThemeMiniPreview themeId={theme.id} />
						<strong>{theme.label}</strong>
						<small>
							{theme.platform} · {theme.aspectRatio}
						</small>
					</button>
				))}
			</div>
			<div className={styles.creatorToolkitSaveRow}>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Template name"
				/>
				<ActionButton
					disabled={!name.trim()}
					onClick={() => {
						const template = captureCreatorTemplate(document, name);
						persist([template, ...templates]);
						setName("");
						toast.success("Template saved locally");
					}}
				>
					<Save size={15} />
					Save current
				</ActionButton>
			</div>
			{templates.length > 0 ? (
				<div className={styles.creatorToolkitList}>
					{templates.map((template) => (
						<div className={styles.creatorToolkitListRow} key={template.id}>
							<span>
								<strong>{template.name}</strong>
								<small>
									{template.editor.aspectRatio} · saved{" "}
									{new Date(template.createdAt).toLocaleDateString()}
								</small>
							</span>
							<button
								type="button"
								onClick={() =>
									void applyDocument(
										applyCreatorTemplate(document, template),
										`${template.name} applied`,
									)
								}
							>
								Apply
							</button>
							<button
								type="button"
								aria-label={`Delete ${template.name}`}
								onClick={() => persist(templates.filter((item) => item.id !== template.id))}
							>
								<Trash2 size={14} />
							</button>
						</div>
					))}
				</div>
			) : null}
		</section>
	);
}

function applyCreatorThemeSafely(
	document: PanelProps["document"],
	themeId: CreatorThemeId,
	visuals: boolean,
) {
	return applyCreatorTheme(document, themeId, { visuals }).document;
}

function ClipsPanel({
	document,
	busy,
	setBusy,
	onCreated,
}: PanelProps & { onCreated: () => void }) {
	const [target, setTarget] = useState<15 | 30 | 60>(30);
	const ideas = useMemo(() => suggestClips(document, target), [document, target]);
	const createVariant = async (index: number) => {
		const idea = ideas[index];
		if (!idea) return;
		setBusy(true);
		try {
			const source = structuredClone(document);
			const shell = await useProjectStore
				.getState()
				.createProject(`${document.project.title} · ${target}s clip ${index + 1}`);
			const variant = buildClipVariantDocument(source, shell.project, idea);
			if (await useProjectStore.getState().saveDocument(variant, { history: false })) {
				toast.success("Clip project created", {
					description: "The original project was not changed.",
				});
				onCreated();
			}
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Make short clips"
				description="Local transcript analysis suggests coherent windows. Opening one creates a separate project, so your original edit stays untouched."
			/>
			<label className={styles.creatorToolkitField}>
				<span>Target length</span>
				<select
					value={target}
					onChange={(event) => setTarget(Number(event.target.value) as 15 | 30 | 60)}
				>
					<option value={15}>Up to 15 seconds</option>
					<option value={30}>Up to 30 seconds</option>
					<option value={60}>Up to 60 seconds</option>
				</select>
			</label>
			<div className={styles.creatorToolkitList}>
				{ideas.length === 0 ? (
					<EmptyState
						text="A transcript with enough speech is needed for clip suggestions."
						compact
					/>
				) : (
					ideas.map((idea, index) => (
						<div key={idea.id} className={styles.creatorToolkitIdea}>
							<div>
								<strong>{idea.title}</strong>
								<small>
									{formatSec(idea.startSec)}–{formatSec(idea.endSec)} ·{" "}
									{idea.durationSec.toFixed(1)}s
								</small>
								<p>{idea.previewText}</p>
							</div>
							<button type="button" disabled={busy} onClick={() => void createVariant(index)}>
								Create separate clip
							</button>
						</div>
					))
				)}
			</div>
		</section>
	);
}

function VariantsPanel({
	document,
	busy,
	setBusy,
	onCreated,
}: PanelProps & { onCreated: () => void }) {
	const [themeId, setThemeId] = useState<CreatorThemeId>("shorts-hook");
	const [visuals, setVisuals] = useState(false);
	const [batchThemeIds, setBatchThemeIds] = useState<CreatorThemeId[]>([
		"social-punch",
		"clean-creator",
		"shorts-hook",
	]);
	const theme = CREATOR_THEMES.find((item) => item.id === themeId) ?? CREATOR_THEMES[0];
	const createThemes = async (themeIds: CreatorThemeId[]) => {
		setBusy(true);
		try {
			const source = structuredClone(document);
			let created = 0;
			for (const id of themeIds) {
				const selectedTheme = CREATOR_THEMES.find((item) => item.id === id);
				if (!selectedTheme) continue;
				const shell = await useProjectStore
					.getState()
					.createProject(`${document.project.title} · ${selectedTheme.label}`);
				const variant = buildSocialVariantDocument(source, shell.project, id, visuals);
				if (await useProjectStore.getState().saveDocument(variant, { history: false }))
					created += 1;
			}
			if (created > 0) {
				toast.success(`${created} social variant${created === 1 ? "" : "s"} created`, {
					description: "Each is a separate linked project; the original was not changed.",
				});
				onCreated();
			}
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Linked social variants"
				description="Preview a destination and create a separate 9:16, 4:5, or 16:9 project. Variants reuse local media but never overwrite the source."
			/>
			<div className={styles.creatorTemplateGrid}>
				{CREATOR_THEMES.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-pressed={themeId === item.id}
						className={
							themeId === item.id ? styles.creatorTemplateCardActive : styles.creatorTemplateCard
						}
						onClick={() => setThemeId(item.id)}
					>
						<ThemeMiniPreview themeId={item.id} />
						<strong>{item.label}</strong>
						<small>
							{item.exportSize.width}×{item.exportSize.height}
						</small>
					</button>
				))}
			</div>
			<ToggleRow
				checked={visuals}
				onChange={setVisuals}
				title="Add template visuals to the new variant"
				detail="Off by default; captions and composition can be changed manually afterward."
			/>
			<ActionButton disabled={busy} onClick={() => void createThemes([themeId])}>
				{busy ? <Loader2 size={15} className="animate-spin" /> : <CopyPlus size={15} />}Create{" "}
				{theme.label} variant
			</ActionButton>
			<PanelHeader
				title="Batch social variants"
				description="Compare the previews above, choose any destinations, and create them together. Nothing is exported or posted."
			/>
			<div className={styles.creatorToolkitChecks}>
				{CREATOR_THEMES.filter((item) =>
					[
						"social-punch",
						"clean-creator",
						"shorts-hook",
						"story-spotlight",
						"youtube-explainer",
						"instagram-feed",
					].includes(item.id),
				).map((item) => (
					<ToggleRow
						key={item.id}
						checked={batchThemeIds.includes(item.id)}
						onChange={(checked) =>
							setBatchThemeIds((current) =>
								checked ? [...current, item.id] : current.filter((id) => id !== item.id),
							)
						}
						title={item.label}
						detail={`${item.exportSize.width}×${item.exportSize.height} · ${item.platform}`}
					/>
				))}
			</div>
			<ActionButton
				disabled={busy || batchThemeIds.length === 0}
				onClick={() => void createThemes(batchThemeIds)}
			>
				<CopyPlus size={15} />
				Create {batchThemeIds.length} selected variants
			</ActionButton>
		</section>
	);
}

function LayoutsPanel({ document, busy, setBusy }: PanelProps) {
	const summary = creatorToolkitSummary(document);
	const recipes = [
		{
			id: "screen-first" as const,
			title: "Screen first",
			detail: "Keep the screen primary and clear all automatic full-camera scenes.",
		},
		{
			id: "camera-hook" as const,
			title: "Camera hook",
			detail: "Start with up to 3.5 seconds of full camera, then return to the screen.",
		},
		{
			id: "camera-pulse" as const,
			title: "Camera pulse",
			detail: "Use short camera reaction moments about every 18 seconds.",
		},
	];
	const apply = async (id: (typeof recipes)[number]["id"]) => {
		setBusy(true);
		try {
			const next = applyLayoutRecipe(document, id);
			if (await useProjectStore.getState().saveDocument(next, { history: true }))
				toast.success("Layout scene recipe applied");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Dynamic layout scenes"
				description="Choose a deterministic camera/screen rhythm. These are normal timeline regions after applying, so you can move or delete every one."
			/>
			{!summary.hasCamera ? (
				<EmptyState
					text="Attach a webcam track before using camera layout scenes. Screen-first remains available."
					compact
				/>
			) : null}
			<div className={styles.creatorToolkitChoiceGrid}>
				{recipes.map((recipe) => (
					<button
						key={recipe.id}
						type="button"
						disabled={busy || (!summary.hasCamera && recipe.id !== "screen-first")}
						onClick={() => void apply(recipe.id)}
					>
						<span className={styles.creatorLayoutPreview} data-layout={recipe.id}>
							<i />
							<i />
						</span>
						<strong>{recipe.title}</strong>
						<small>{recipe.detail}</small>
					</button>
				))}
			</div>
		</section>
	);
}

function PrivacyPanel({ document, busy, setBusy }: PanelProps) {
	const findings = useMemo(() => scanPrivacy(document), [document]);
	const revision = useProjectStore((state) => state.revision);
	const durationSec = creatorToolkitSummary(document).durationSec;
	const primaryAsset =
		document.assets.find((asset) => asset.id === document.project.primaryAssetId) ??
		document.assets[0];
	const [visionReview, setVisionReview] = useState<{
		assetId: string;
		sourceRevision: number;
		sampledFrames: number;
		candidates: PrivacyVisionCandidate[];
	} | null>(null);
	const [selectedVisionIds, setSelectedVisionIds] = useState<string[]>([]);
	const [nameClassifiedBy, setNameClassifiedBy] = useState<string | null>(null);
	const [position, setPosition] = useState<PrivacyMaskPosition>("top-right");
	const [trackFrom, setTrackFrom] = useState<PrivacyMaskPosition>("top-left");
	const [trackTo, setTrackTo] = useState<PrivacyMaskPosition>("bottom-right");
	const [trackStart, setTrackStart] = useState(0);
	const [trackEnd, setTrackEnd] = useState(Math.min(8, durationSec));
	const apply = async () => {
		setBusy(true);
		try {
			if (
				await useProjectStore
					.getState()
					.saveDocument(applyPrivacyMask(document, position), { history: true })
			)
				toast.success("Privacy mask added", {
					description: "Resize, move, or delete it like any other blur annotation.",
				});
		} finally {
			setBusy(false);
		}
	};
	const applyTracked = async () => {
		setBusy(true);
		try {
			const next = applyTrackedPrivacyMask(document, {
				startSec: trackStart,
				endSec: trackEnd,
				from: trackFrom,
				to: trackTo,
			});
			if (await useProjectStore.getState().saveDocument(next, { history: true })) {
				toast.success("Tracked privacy mask added", {
					description: "Review the interpolated mosaic regions on the timeline before export.",
				});
			}
		} finally {
			setBusy(false);
		}
	};
	const scanVisualPrivacy = async () => {
		if (!primaryAsset) return;
		setBusy(true);
		try {
			const result = await window.electronAPI.analyzePrivacyVision({
				videoPath: primaryAsset.originalPath,
				includeFaces: true,
				includeText: true,
				maxSamples: 240,
			});
			if (!result.success) throw new Error(result.error);
			setVisionReview({
				assetId: primaryAsset.id,
				sourceRevision: revision,
				sampledFrames: result.sampledFrames,
				candidates: result.candidates,
			});
			setSelectedVisionIds([]);
			setNameClassifiedBy(null);
			toast.success("Local visual privacy scan is ready for review", {
				description: `${result.candidates.length} candidate${result.candidates.length === 1 ? "" : "s"} found. Nothing has been masked yet.`,
			});
		} catch (error) {
			toast.error("Visual privacy scan did not complete", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};
	const classifyPossibleNames = async () => {
		if (!visionReview) return;
		setBusy(true);
		try {
			if (useProjectStore.getState().revision !== visionReview.sourceRevision) {
				throw new Error(
					"The project changed after the scan. Run the visual privacy review again before classifying names.",
				);
			}
			const candidates = visionReview.candidates
				.filter((candidate) => candidate.previewText?.trim())
				.slice(0, 120)
				.map((candidate) => ({ id: candidate.id, text: candidate.previewText ?? "" }));
			const result = await nativeBridgeClient.aiEdition.classifyPrivacyNames(candidates);
			if (!result.success) throw new Error(result.error ?? "Local name classification failed.");
			const proposed = new Set(result.nameCandidateIds);
			setVisionReview((current) =>
				current
					? {
							...current,
							candidates: current.candidates.map((candidate) =>
								proposed.has(candidate.id)
									? { ...candidate, label: "Possible person name" }
									: candidate,
							),
						}
					: current,
			);
			setNameClassifiedBy(result.model ?? "local model");
			toast.success("Local name suggestions are ready for review", {
				description: `${result.nameCandidateIds.length} possible name${result.nameCandidateIds.length === 1 ? "" : "s"} flagged. No candidate was selected or masked automatically.`,
			});
		} catch (error) {
			toast.error("Local name classification did not complete", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};
	const applyVisionMasks = async () => {
		if (!visionReview || selectedVisionIds.length === 0) return;
		setBusy(true);
		try {
			const store = useProjectStore.getState();
			if (!store.document || store.revision !== visionReview.sourceRevision) {
				throw new Error(
					"The project changed after the scan. Run the visual privacy review again before applying masks.",
				);
			}
			const selected = visionReview.candidates.filter((item) =>
				selectedVisionIds.includes(item.id),
			);
			const next = applyVisionPrivacyCandidates(store.document, visionReview.assetId, selected);
			if (await store.saveDocument(next, { history: true })) {
				toast.success("Confirmed visual masks added", {
					description: "Review every generated keyframe in preview before relying on the masks.",
				});
			}
		} catch (error) {
			toast.error("Visual privacy masks were not applied", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};
	const visibleVisionCandidates = visionReview?.candidates.slice(0, 120) ?? [];
	return (
		<section>
			<PanelHeader
				title="Privacy review"
				description="Transcript and macOS Vision scans stay on this Mac. They only propose candidates; nothing is hidden, uploaded, or changed until you confirm it."
			/>
			<div className={styles.creatorToolkitMetrics}>
				<Metric label="Possible findings" value={String(findings.length)} />
				<Metric label="Where scan runs" value="On this Mac" />
			</div>
			{findings.length ? (
				<div className={styles.creatorToolkitList}>
					{findings.map((item) => (
						<div className={styles.creatorToolkitListRow} key={item.id}>
							<ShieldCheck size={15} />
							<span>
								<strong>
									{item.type} · {formatSec(item.startSec)}
								</strong>
								<small>{item.preview}</small>
							</span>
						</div>
					))}
				</div>
			) : (
				<EmptyState
					text="No email, phone-number, or credential phrases were found in the transcript. Visual details can still exist on screen, so review the video."
					compact
				/>
			)}
			<PanelHeader
				title="Visual privacy candidates"
				description="Scan sampled frames for faces and on-screen text, then select only the regions you want masked. Detection can miss or misidentify details. Protection is not complete until you review the full preview."
			/>
			<ActionButton disabled={busy || !primaryAsset} onClick={() => void scanVisualPrivacy()}>
				<Eye size={15} />
				Scan current video on this Mac
			</ActionButton>
			{visionReview ? (
				<>
					<div className={styles.creatorToolkitMetrics}>
						<Metric label="Frames sampled" value={String(visionReview.sampledFrames)} />
						<Metric label="Candidates" value={String(visionReview.candidates.length)} />
					</div>
					<ActionButton
						disabled={
							busy || !visionReview.candidates.some((candidate) => candidate.previewText?.trim())
						}
						onClick={() => void classifyPossibleNames()}
					>
						<Sparkles size={15} />
						Ask configured local AI to flag possible person names
					</ActionButton>
					{nameClassifiedBy ? (
						<p className={styles.creatorToolkitNote}>
							Name suggestions came from {nameClassifiedBy} on this Mac. They remain unselected
							until you review them.
						</p>
					) : null}
					<div className={styles.creatorToolkitList}>
						{visibleVisionCandidates.map((candidate) => (
							<label className={styles.creatorToolkitListRow} key={candidate.id}>
								<input
									type="checkbox"
									checked={selectedVisionIds.includes(candidate.id)}
									onChange={(event) =>
										setSelectedVisionIds((current) =>
											event.target.checked
												? [...current, candidate.id]
												: current.filter((id) => id !== candidate.id),
										)
									}
								/>
								<span>
									<strong>
										{candidate.label} · {formatSec(candidate.startSec)}–
										{formatSec(candidate.endSec)} · {Math.round(candidate.confidence * 100)}%
									</strong>
									<small>
										{candidate.previewText ?? `${candidate.keyframes.length} tracked positions`}
									</small>
								</span>
							</label>
						))}
					</div>
					{visionReview.candidates.length > visibleVisionCandidates.length ? (
						<p className={styles.creatorToolkitNote}>
							Showing the first {visibleVisionCandidates.length} candidates. Narrow the source or
							review this batch before scanning the next section.
						</p>
					) : null}
					<ActionButton
						disabled={busy || selectedVisionIds.length === 0}
						onClick={() => void applyVisionMasks()}
					>
						<ShieldCheck size={15} />
						Add {selectedVisionIds.length} confirmed tracked mask
						{selectedVisionIds.length === 1 ? "" : "s"}
					</ActionButton>
				</>
			) : null}
			<label className={styles.creatorToolkitField}>
				<span>Add an optional visual mask</span>
				<select
					value={position}
					onChange={(event) => setPosition(event.target.value as PrivacyMaskPosition)}
				>
					<option value="top-left">Top left</option>
					<option value="top-right">Top right</option>
					<option value="bottom-left">Bottom left</option>
					<option value="bottom-right">Bottom right</option>
				</select>
			</label>
			<ActionButton disabled={busy} onClick={() => void apply()}>
				<Eye size={15} />
				Add editable mosaic mask
			</ActionButton>
			<PanelHeader
				title="Tracked visual mask"
				description="Confirm where the detail starts and ends. OpenScreen creates editable in-between masks; it does not treat an unreviewed OCR guess as safe."
			/>
			<div className={styles.creatorToolkitSaveRow}>
				<label className={styles.creatorToolkitField}>
					<span>Start at</span>
					<select
						value={trackFrom}
						onChange={(event) => setTrackFrom(event.target.value as PrivacyMaskPosition)}
					>
						{Object.entries(MASK_POSITION_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label className={styles.creatorToolkitField}>
					<span>End at</span>
					<select
						value={trackTo}
						onChange={(event) => setTrackTo(event.target.value as PrivacyMaskPosition)}
					>
						{Object.entries(MASK_POSITION_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className={styles.creatorToolkitSaveRow}>
				<label className={styles.creatorToolkitField}>
					<span>Start second</span>
					<input
						type="number"
						min={0}
						max={durationSec}
						step={0.1}
						value={trackStart}
						onChange={(event) => setTrackStart(Math.max(0, Number(event.target.value)))}
					/>
				</label>
				<label className={styles.creatorToolkitField}>
					<span>End second</span>
					<input
						type="number"
						min={0}
						max={durationSec}
						step={0.1}
						value={trackEnd}
						onChange={(event) =>
							setTrackEnd(Math.min(durationSec, Math.max(0, Number(event.target.value))))
						}
					/>
				</label>
			</div>
			<ActionButton disabled={busy || trackEnd <= trackStart} onClick={() => void applyTracked()}>
				<Eye size={15} />
				Add reviewable tracked mask
			</ActionButton>
		</section>
	);
}

const MASK_POSITION_LABELS: Record<PrivacyMaskPosition, string> = {
	"top-left": "Top left",
	"top-right": "Top right",
	"bottom-left": "Bottom left",
	"bottom-right": "Bottom right",
};

function AudioPanel({ document, busy, setBusy }: PanelProps) {
	const existing = getAudioEnhancement(document);
	const [enabled, setEnabled] = useState(existing.enabled);
	const [preset, setPreset] = useState(existing.preset);
	const [intensity, setIntensity] = useState(existing.intensity);
	const [noiseReductionStrength, setNoiseReductionStrength] = useState(
		existing.noiseReductionStrength,
	);
	const [masteringTarget, setMasteringTarget] = useState(existing.masteringTarget);
	const [limiterEnabled, setLimiterEnabled] = useState(existing.limiterEnabled);
	const [musicDuckingEnabled, setMusicDuckingEnabled] = useState(existing.musicDuckingEnabled);
	const [musicDuckingAmountDb, setMusicDuckingAmountDb] = useState(existing.musicDuckingAmountDb);
	const apply = async () => {
		setBusy(true);
		try {
			const next = patchAudioEnhancement(document, {
				enabled,
				preset,
				intensity,
				noiseReductionStrength,
				masteringTarget,
				limiterEnabled,
				musicDuckingEnabled,
				musicDuckingAmountDb,
			});
			if (await useProjectStore.getState().saveDocument(next, { history: true }))
				toast.success(enabled ? "Local voice enhancement enabled" : "Voice enhancement turned off");
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Local audio enhancement"
				description="Optional voice processing stays local. Core EQ/leveling is previewed live; whole-programme cleanup, loudness, limiter, and music ducking are finalized during export. Off preserves the original audio exactly."
			/>
			<ToggleRow
				checked={enabled}
				onChange={setEnabled}
				title="Enhance programme voice"
				detail="Off by default for every project."
			/>
			<label className={styles.creatorToolkitField}>
				<span>Voice preset</span>
				<select
					disabled={!enabled}
					value={preset}
					onChange={(event) => setPreset(event.target.value as typeof preset)}
				>
					<option value="clarity">Clarity · gentle low-cut and leveling</option>
					<option value="podcast">Podcast · warmer, steadier voice</option>
					<option value="broadcast">Broadcast · stronger leveling and presence</option>
				</select>
			</label>
			<label className={styles.creatorToolkitRange}>
				<span>
					Intensity <strong>{Math.round(intensity * 100)}%</strong>
				</span>
				<input
					disabled={!enabled}
					type="range"
					min={0}
					max={100}
					value={Math.round(intensity * 100)}
					onChange={(event) => setIntensity(Number(event.target.value) / 100)}
				/>
			</label>
			<label className={styles.creatorToolkitRange}>
				<span>
					Room-noise cleanup <strong>{Math.round(noiseReductionStrength * 100)}%</strong>
				</span>
				<input
					disabled={!enabled}
					type="range"
					min={0}
					max={100}
					value={Math.round(noiseReductionStrength * 100)}
					onChange={(event) => setNoiseReductionStrength(Number(event.target.value) / 100)}
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Measured export loudness</span>
				<select
					disabled={!enabled}
					value={masteringTarget}
					onChange={(event) => setMasteringTarget(event.target.value as typeof masteringTarget)}
				>
					<option value="off">Off · keep source loudness</option>
					<option value="social">Social video · -14 LUFS target</option>
					<option value="podcast">Podcast · -16 LUFS target</option>
					<option value="broadcast">Broadcast-safe · -18 LUFS target</option>
				</select>
			</label>
			<ToggleRow
				checked={limiterEnabled}
				onChange={setLimiterEnabled}
				disabled={!enabled}
				title="Safety limiter at -1 dB"
				detail="Prevents normalized peaks from clipping during export."
			/>
			<ToggleRow
				checked={musicDuckingEnabled}
				onChange={setMusicDuckingEnabled}
				disabled={!enabled || !getEditorSettings(document).backgroundMusicPath}
				title="Automatically lower music under speech"
				detail="Side-chain ducking follows programme voice and leaves quiet sections fuller."
			/>
			<label className={styles.creatorToolkitRange}>
				<span>
					Music ducking <strong>{Math.round(musicDuckingAmountDb)} dB</strong>
				</span>
				<input
					disabled={!enabled || !musicDuckingEnabled}
					type="range"
					min={0}
					max={24}
					value={musicDuckingAmountDb}
					onChange={(event) => setMusicDuckingAmountDb(Number(event.target.value))}
				/>
			</label>
			<p className={styles.creatorToolkitNote}>
				For noisy source recordings, start around 25–45%. Preview mirrors the voice chain;
				whole-programme loudness, limiter, and music ducking are measured authoritatively during
				export. Every control is non-destructive and optional.
			</p>
			<ActionButton disabled={busy} onClick={() => void apply()}>
				<AudioLines size={15} />
				Save audio choice
			</ActionButton>
		</section>
	);
}

function BrandKitsPanel({ document, busy, setBusy }: PanelProps) {
	const [name, setName] = useState("");
	const [primaryColor, setPrimaryColor] = useState("#10b981");
	const [secondaryColor, setSecondaryColor] = useState("#0f766e");
	const [textColor, setTextColor] = useState("#ffffff");
	const [fontFamily, setFontFamily] = useState("Inter");
	const [logoPath, setLogoPath] = useState("");
	const [lowerThirdText, setLowerThirdText] = useState("");
	const [introText, setIntroText] = useState("");
	const [outroText, setOutroText] = useState("");
	const [kits, setKits] = useState<BrandKit[]>(() => loadBrandKits(localStorage));
	const persist = (next: BrandKit[]) => {
		setKits(next);
		saveBrandKits(localStorage, next);
	};
	const apply = async (kit: BrandKit) => {
		setBusy(true);
		try {
			if (
				await useProjectStore
					.getState()
					.saveDocument(applyBrandKit(document, kit), { history: true })
			) {
				toast.success(`${kit.name} applied`, {
					description: "Captions, logo, and lower-third remain normal editable elements.",
				});
			}
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Optional local brand kits"
				description="Save brand colors, font, an optional local logo, lower-third, intro card, and outro card. Applying a kit is one undoable edit, never exports or publishes, and keeps every added element editable."
			/>
			<label className={styles.creatorToolkitField}>
				<span>Kit name</span>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="My brand"
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Primary color</span>
				<input
					type="color"
					value={primaryColor}
					onChange={(event) => setPrimaryColor(event.target.value)}
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Secondary color</span>
				<input
					type="color"
					value={secondaryColor}
					onChange={(event) => setSecondaryColor(event.target.value)}
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Text color</span>
				<input
					type="color"
					value={textColor}
					onChange={(event) => setTextColor(event.target.value)}
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Font family</span>
				<input
					value={fontFamily}
					onChange={(event) => setFontFamily(event.target.value)}
					placeholder="Inter"
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Logo image path (optional)</span>
				<input
					value={logoPath}
					onChange={(event) => setLogoPath(event.target.value)}
					placeholder="/path/to/logo.png"
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Lower-third text (optional)</span>
				<input
					value={lowerThirdText}
					onChange={(event) => setLowerThirdText(event.target.value)}
					placeholder="Name · Role"
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Intro card text (optional)</span>
				<input
					value={introText}
					onChange={(event) => setIntroText(event.target.value)}
					placeholder="Welcome to the channel"
				/>
			</label>
			<label className={styles.creatorToolkitField}>
				<span>Outro card text (optional)</span>
				<input
					value={outroText}
					onChange={(event) => setOutroText(event.target.value)}
					placeholder="Follow for more"
				/>
			</label>
			<ActionButton
				disabled={!name.trim()}
				onClick={() => {
					const kit = captureBrandKit(document, {
						name,
						primaryColor,
						secondaryColor,
						textColor,
						fontFamily,
						logoPath,
						lowerThirdText,
						introText,
						outroText,
					});
					persist([kit, ...kits]);
					setName("");
					setLogoPath("");
					setLowerThirdText("");
					setIntroText("");
					setOutroText("");
					toast.success("Brand kit saved locally");
				}}
			>
				<Save size={15} />
				Save brand kit
			</ActionButton>
			{kits.length ? (
				<div className={styles.creatorToolkitList}>
					{kits.map((kit) => (
						<div className={styles.creatorToolkitListRow} key={kit.id}>
							<span
								aria-hidden
								style={{ width: 14, height: 14, borderRadius: 99, background: kit.primaryColor }}
							/>
							<span>
								<strong>{kit.name}</strong>
								<small>
									{kit.fontFamily} · {kit.lowerThirdText || "No lower-third"} ·{" "}
									{kit.introText || kit.outroText ? "Cards included" : "No intro/outro cards"}
								</small>
							</span>
							<button type="button" disabled={busy} onClick={() => void apply(kit)}>
								Apply
							</button>
							<button
								type="button"
								aria-label={`Delete ${kit.name}`}
								onClick={() => persist(kits.filter((item) => item.id !== kit.id))}
							>
								<Trash2 size={14} />
							</button>
						</div>
					))}
				</div>
			) : null}
		</section>
	);
}

function RecoveryPanel({ document, busy, setBusy }: PanelProps) {
	const [snapshots, setSnapshots] = useState<AiEditionProjectSnapshotSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const projectId = document.project.id;
	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			setSnapshots(await nativeBridgeClient.aiEdition.listSnapshots(projectId));
		} catch (error) {
			toast.error("Recovery points could not be loaded", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setLoading(false);
		}
	}, [projectId]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const create = async () => {
		setBusy(true);
		try {
			await nativeBridgeClient.aiEdition.createSnapshot(
				document.project.id,
				"Manual restore point",
				"manual",
			);
			await refresh();
			toast.success("Restore point created");
		} catch (error) {
			toast.error("Restore point failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};
	const restore = async (snapshotId: string) => {
		setBusy(true);
		try {
			const result = await nativeBridgeClient.aiEdition.restoreSnapshot(
				document.project.id,
				snapshotId,
			);
			if (!result.success) throw new Error(result.error ?? "Restore failed");
			await useProjectStore.getState().loadProject(document.project.id);
			await refresh();
			toast.success("Project restored", {
				description: "The state you replaced was saved as another recovery point.",
			});
		} catch (error) {
			toast.error("Project was not restored", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};
	const collect = async () => {
		setBusy(true);
		try {
			const result = await nativeBridgeClient.aiEdition.collectMedia(document.project.id);
			toast.success("Portable project collected", {
				description: `${result.mediaCount} media file${result.mediaCount === 1 ? "" : "s"} copied with checksums.`,
			});
			void window.electronAPI?.revealInFolder?.(result.manifestPath);
		} catch (error) {
			toast.error("Portable project could not be created", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};
	return (
		<section>
			<PanelHeader
				title="Autosave, recovery, and portable media"
				description="Automatic recovery points are retained in the background. Manual points protect important edits, and Collect Media makes a checksum-verified project folder for moving or archiving."
			/>
			<div className={styles.creatorToolkitSaveRow}>
				<ActionButton disabled={busy} onClick={() => void create()}>
					<ArchiveRestore size={15} />
					Create restore point
				</ActionButton>
				<ActionButton
					disabled={busy || document.assets.length === 0}
					onClick={() => void collect()}
				>
					<PackageOpen size={15} />
					Collect media
				</ActionButton>
			</div>
			{loading ? (
				<EmptyState text="Loading recovery points…" compact />
			) : snapshots.length === 0 ? (
				<EmptyState
					text="No restore points yet. OpenScreen will create automatic points as the project changes."
					compact
				/>
			) : (
				<div className={styles.creatorToolkitList}>
					{snapshots.map((snapshot) => (
						<div key={snapshot.id} className={styles.creatorToolkitListRow}>
							<ArchiveRestore size={15} />
							<span>
								<strong>{snapshot.label}</strong>
								<small>
									{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.reason}
								</small>
							</span>
							<button type="button" disabled={busy} onClick={() => void restore(snapshot.id)}>
								Restore
							</button>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function PerformancePanel({ document }: Pick<PanelProps, "document">) {
	const assessment = assessProjectPerformance(document);
	return (
		<section>
			<PanelHeader
				title="Project performance budget"
				description="This live complexity check never changes the edit. It warns before duration, captions, or thousands of tiny regions make preview work unnecessarily hard."
			/>
			<div className={styles.creatorToolkitMetrics}>
				<Metric label="Status" value={assessment.level} />
				<Metric label="Duration" value={formatSec(assessment.durationSec)} />
				<Metric label="Edit regions" value={assessment.editCount.toLocaleString()} />
				<Metric label="Caption words" value={assessment.captionWordCount.toLocaleString()} />
			</div>
			{assessment.recommendations.length ? (
				<div className={styles.creatorToolkitList}>
					{assessment.recommendations.map((item) => (
						<div className={styles.creatorToolkitListRow} key={item}>
							<Activity size={15} />
							<span>
								<strong>{item}</strong>
							</span>
						</div>
					))}
				</div>
			) : (
				<EmptyState text="This project is inside the guarded preview budget." compact />
			)}
		</section>
	);
}

interface PanelProps {
	document: NonNullable<ReturnType<typeof useProjectStore.getState>["document"]>;
	busy: boolean;
	setBusy: (busy: boolean) => void;
}

function PanelHeader({ title, description }: { title: string; description: string }) {
	return (
		<header className={styles.creatorToolkitHeader}>
			<h3>{title}</h3>
			<p>{description}</p>
		</header>
	);
}
function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<small>{label}</small>
			<strong>{value}</strong>
		</div>
	);
}
function ToggleRow({
	checked,
	onChange,
	disabled = false,
	title,
	detail,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
	title: string;
	detail: string;
}) {
	return (
		<label
			className={styles.creatorToolkitToggle}
			style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
		>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span>
				<strong>{title}</strong>
				<small>{detail}</small>
			</span>
		</label>
	);
}
function ActionButton({
	children,
	disabled,
	onClick,
}: {
	children: ReactNode;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={styles.creatorToolkitAction}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
	return (
		<div className={compact ? styles.creatorToolkitEmptyCompact : styles.creatorToolkitEmpty}>
			{text}
		</div>
	);
}
function ThemeMiniPreview({ themeId }: { themeId: CreatorThemeId }) {
	const theme = CREATOR_THEMES.find((item) => item.id === themeId) ?? CREATOR_THEMES[0];
	return (
		<span
			className={styles.creatorTemplatePreview}
			style={{ background: theme.preview.background }}
		>
			<i style={{ background: theme.preview.accent }} />
			<b>{theme.aspectRatio}</b>
			<em>{theme.preview.caption === "bold" ? "Aa" : "Caption"}</em>
		</span>
	);
}
