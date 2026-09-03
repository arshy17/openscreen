import {
	ArrowDown,
	ArrowUp,
	Copy,
	Download,
	FileImage,
	Images,
	LayoutTemplate,
	Plus,
	Smile,
	Sparkles,
	Trash2,
	Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import {
	ARTWORK_PRESETS,
	applyArtworkSuggestion,
	artworkTextWarnings,
	buildOpeningCardVariantDocument,
	createArtworkDesign,
	getArtworkPreset,
	replaceArtworkDesign,
	updateArtworkDesign,
} from "@/lib/ai-edition/artwork";
import { renderArtworkToBlob, resizeArtworkDesign } from "@/lib/ai-edition/artworkRenderer";
import { createId } from "@/lib/ai-edition/document/ids";
import type { ArtworkAsset, ArtworkDesign, ArtworkLayer } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { nativeBridgeClient } from "@/native/client";
import type { ArtworkFrameCandidate, ArtworkSuggestionVariant } from "@/native/contracts";
import styles from "./ArtworkStage.module.css";

function cleanName(value: string): string {
	return value.replace(/[^A-Za-z0-9 _-]/g, "-").trim() || "artwork";
}

function imageLayer(asset: ArtworkAsset, design: ArtworkDesign): ArtworkLayer {
	return {
		id: createId("artlayer"),
		name: asset.label,
		type: "image",
		assetId: asset.id,
		x: 0,
		y: 0,
		width: design.width,
		height: design.height,
		rotation: 0,
		opacity: 1,
		visible: true,
		zIndex: 0,
		fit: "cover",
		cropX: 0.5,
		cropY: 0.5,
		blur: 0,
		cutout: false,
	};
}

function LayerView({
	layer,
	asset,
	scale,
	selected,
	onSelect,
	onCommit,
}: {
	layer: ArtworkLayer;
	asset?: ArtworkAsset;
	scale: number;
	selected: boolean;
	onSelect: () => void;
	onCommit: (layer: ArtworkLayer) => void;
}) {
	const [draft, setDraft] = useState(layer);
	useEffect(() => setDraft(layer), [layer]);
	const begin = (event: React.PointerEvent, resize = false) => {
		event.preventDefault();
		event.stopPropagation();
		onSelect();
		const startX = event.clientX,
			startY = event.clientY,
			original = draft;
		const move = (next: PointerEvent) => {
			const dx = (next.clientX - startX) / scale,
				dy = (next.clientY - startY) / scale;
			setDraft(
				resize
					? {
							...original,
							width: Math.max(24, original.width + dx),
							height: Math.max(24, original.height + dy),
						}
					: { ...original, x: original.x + dx, y: original.y + dy },
			);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			setDraft((value) => {
				onCommit(value);
				return value;
			});
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up, { once: true });
	};
	const common: React.CSSProperties = {
		left: draft.x * scale,
		top: draft.y * scale,
		width: draft.width * scale,
		height: draft.height * scale,
		opacity: draft.opacity,
		transform: `rotate(${draft.rotation}deg)`,
		zIndex: draft.zIndex,
	};
	return (
		<div
			className={styles.layer}
			data-selected={selected}
			style={common}
			onPointerDown={(e) => begin(e)}
		>
			{draft.type === "image" && asset ? (
				<img
					alt=""
					draggable={false}
					src={toFileUrl(asset.path)}
					style={{
						width: "100%",
						height: "100%",
						objectFit: draft.fit,
						objectPosition: `${draft.cropX * 100}% ${draft.cropY * 100}%`,
						filter: draft.blur ? `blur(${draft.blur * scale}px)` : undefined,
					}}
				/>
			) : null}
			{draft.type === "shape" ? (
				<div
					style={{
						width: "100%",
						height: "100%",
						borderRadius: draft.shape === "ellipse" ? "50%" : draft.cornerRadius * scale,
						background: draft.fill,
						border: `${draft.strokeWidth * scale}px solid ${draft.stroke}`,
					}}
				/>
			) : null}
			{draft.type === "icon" ? (
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "grid",
						placeItems: "center",
						fontSize: Math.min(draft.width, draft.height) * scale * 0.72,
						color: draft.color,
						background: draft.background ?? undefined,
						borderRadius: "50%",
					}}
				>
					{draft.icon === "play"
						? "▶"
						: draft.icon === "check"
							? "✓"
							: draft.icon === "arrow"
								? "➜"
								: "★"}
				</div>
			) : null}
			{draft.type === "text" ? (
				<div
					style={{
						width: "100%",
						height: "100%",
						fontFamily: draft.fontFamily,
						fontSize: draft.fontSize * scale,
						fontWeight: draft.fontWeight,
						color: draft.color,
						textAlign: draft.align,
						WebkitTextStroke: `${draft.strokeWidth * scale}px ${draft.strokeColor}`,
						textShadow: `0 2px ${draft.shadowBlur * scale}px ${draft.shadowColor}`,
						lineHeight: 1.12,
						whiteSpace: "pre-wrap",
						overflow: "hidden",
					}}
				>
					{draft.text}
				</div>
			) : null}
			{selected ? <span className={styles.resize} onPointerDown={(e) => begin(e, true)} /> : null}
		</div>
	);
}

export function ArtworkStage() {
	const document = useProjectStore((s) => s.document);
	const projectId = useProjectStore((s) => s.projectId);
	const currentTimeSec = useProjectStore((s) => s.currentTimeSec);
	const importProjectMedia = useProjectStore((s) => s.importProjectMedia);
	const saveDocument = useProjectStore((s) => s.saveDocument);
	const [designId, setDesignId] = useState<string | null>(null);
	const savedDesign =
		document?.artworkDesigns.find((item) => item.id === designId) ??
		document?.artworkDesigns[0] ??
		null;
	const [design, setDesign] = useState<ArtworkDesign | null>(savedDesign);
	const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
	const [candidates, setCandidates] = useState<ArtworkFrameCandidate[]>([]);
	const [suggestions, setSuggestions] = useState<ArtworkSuggestionVariant[]>([]);
	const [instructions, setInstructions] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [showSafe, setShowSafe] = useState(true);
	const [showGuides, setShowGuides] = useState(true);
	const [showPrevious, setShowPrevious] = useState(false);
	const [openingDuration, setOpeningDuration] = useState(2);
	const [mock, setMock] = useState<"canvas" | "phone" | "feed" | "search">("canvas");
	const viewport = useRef<HTMLDivElement>(null);
	const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
	useEffect(() => {
		if (savedDesign) setDesign(savedDesign);
	}, [savedDesign]);
	useEffect(() => {
		const node = viewport.current;
		if (!node) return;
		const observer = new ResizeObserver(([entry]) =>
			setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	const scale = design
		? Math.min(
				(viewportSize.width - 48) / design.width,
				(viewportSize.height - 48) / design.height,
				1,
			)
		: 1;
	const assets = document?.artworkAssets ?? [];
	const assetMap = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);
	const selectedLayer = design?.layers.find((item) => item.id === selectedLayerId) ?? null;
	const displayLayers =
		showPrevious && design?.revisions.at(-1)?.layers
			? design.revisions.at(-1)?.layers
			: design?.layers;
	const persist = async (next: ArtworkDesign, label: string) => {
		const currentDocument = useProjectStore.getState().document;
		if (!currentDocument) return;
		const committed = label ? updateArtworkDesign(next, {}, label) : next;
		setDesign(committed);
		setDesignId(committed.id);
		await saveDocument(replaceArtworkDesign(currentDocument, committed), { history: true });
	};
	const createDesign = async (presetId: string) => {
		if (!document) return;
		const next = createArtworkDesign(presetId, document.project.title, {
			assetId: document.project.primaryAssetId,
			timeSec: currentTimeSec,
		});
		await persist(next, "");
		setSelectedLayerId(next.layers[0]?.id ?? null);
	};
	const patchLayer = (id: string, patch: Partial<ArtworkLayer>) => {
		if (!design) return;
		setDesign({
			...design,
			layers: design.layers.map((item) =>
				item.id === id ? ({ ...item, ...patch } as ArtworkLayer) : item,
			),
		});
	};
	const commitLayer = (nextLayer: ArtworkLayer) => {
		if (!design) return;
		void persist(
			{
				...design,
				layers: design.layers.map((item) => (item.id === nextLayer.id ? nextLayer : item)),
			},
			`Edit ${nextLayer.name}`,
		);
	};
	const addLayer = (layer: ArtworkLayer) => {
		if (!design) return;
		const next = { ...design, layers: [...design.layers, layer] };
		setSelectedLayerId(layer.id);
		void persist(next, `Add ${layer.name}`);
	};
	const removeLayer = (layerId: string) => {
		if (!design) return;
		setSelectedLayerId(null);
		void persist(
			{ ...design, layers: design.layers.filter((layer) => layer.id !== layerId) },
			"Delete artwork layer",
		);
	};
	const moveLayer = (layerId: string, direction: -1 | 1) => {
		if (!design) return;
		const layer = design.layers.find((item) => item.id === layerId);
		if (!layer) return;
		commitLayer({ ...layer, zIndex: layer.zIndex + direction });
	};
	const importImage = async (
		source: "files" | "photos",
		paths?: string[],
		candidate?: ArtworkFrameCandidate,
	) => {
		if (!projectId || !design) return;
		const picked = paths
			? { success: true, paths }
			: await window.electronAPI?.openProjectMediaPicker?.({ source, mediaKinds: ["artwork"] });
		if (!picked?.success || !picked.paths?.length) return;
		setBusy("import");
		try {
			const result = await importProjectMedia(source, picked.paths, ["artwork"]);
			const id = result.items.find((item) => item.success)?.artworkAssetId;
			let latest = useProjectStore.getState().document;
			let asset = latest?.artworkAssets.find((item) => item.id === id);
			if (asset && latest) {
				if (candidate) {
					asset = {
						...asset,
						source: "video-frame",
						sourceAssetId: candidate.assetId,
						sourceTimeSec: candidate.timeSec,
					};
					latest = {
						...latest,
						artworkAssets: latest.artworkAssets.map((item) =>
							item.id === asset?.id ? asset : item,
						),
					};
				}
				const current = latest.artworkDesigns.find((item) => item.id === design.id) ?? design;
				const next = updateArtworkDesign(
					{ ...current, layers: [...current.layers, imageLayer(asset, current)] },
					{},
					"Add source image",
				);
				setDesign(next);
				setSelectedLayerId(next.layers.at(-1)?.id ?? null);
				await saveDocument(replaceArtworkDesign(latest, next), { history: true });
			}
			const failures = result.items.filter((item) => !item.success);
			if (failures.length) toast.error(failures.map((item) => item.error).join("\n"));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};
	const applyFrame = async (candidate: ArtworkFrameCandidate) => {
		await importImage("files", [candidate.path], candidate);
	};
	const generateFrames = async (capture = false) => {
		if (!projectId || !document?.project.primaryAssetId) return;
		setBusy("frames");
		try {
			const result = capture
				? [
						await nativeBridgeClient.aiEdition.captureArtworkFrame(
							projectId,
							document.project.primaryAssetId,
							currentTimeSec,
						),
					]
				: await nativeBridgeClient.aiEdition.generateArtworkCandidates(
						projectId,
						document.project.primaryAssetId,
						8,
					);
			setCandidates(result);
		} catch (error) {
			toast.error("Frame analysis failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(null);
		}
	};
	const suggest = async () => {
		if (!projectId) return;
		setBusy("ai");
		try {
			const result = await nativeBridgeClient.aiEdition.suggestArtwork(projectId, instructions);
			if (!result.success) throw new Error(result.error);
			setSuggestions(result.variants);
			if (result.error) toast.info(result.error);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};
	const cutoutSelectedImage = async () => {
		if (!projectId || !design || selectedLayer?.type !== "image") return;
		setBusy("cutout");
		try {
			const cutout = await nativeBridgeClient.aiEdition.createArtworkSubjectCutout(
				projectId,
				selectedLayer.assetId,
			);
			const imported = await importProjectMedia("files", [cutout.path], ["artwork"]);
			const artworkAssetId = imported.items.find((item) => item.success)?.artworkAssetId;
			const latest = useProjectStore.getState().document;
			if (!artworkAssetId || !latest)
				throw new Error("The cutout could not be added to the project.");
			const current = latest.artworkDesigns.find((item) => item.id === design.id) ?? design;
			const next = updateArtworkDesign(
				{
					...current,
					layers: current.layers.map((layer) =>
						layer.id === selectedLayer.id && layer.type === "image"
							? { ...layer, assetId: artworkAssetId, cutout: true }
							: layer,
					),
				},
				{},
				"Create local subject cutout",
			);
			setDesign(next);
			await saveDocument(replaceArtworkDesign(latest, next), { history: true });
			toast.success("Background removed locally", {
				description: "Review the transparent edge before exporting.",
			});
		} catch (error) {
			toast.error("Subject cutout failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(null);
		}
	};
	const applySuggestion = (variant: ArtworkSuggestionVariant) => {
		if (design) void persist(applyArtworkSuggestion(design, variant), "");
	};
	const exportOne = async (format: "png" | "jpeg") => {
		if (!design || !projectId) return;
		setBusy("export");
		try {
			const blob = await renderArtworkToBlob(design, assets, format, 0.92);
			const result = await window.electronAPI?.renderArtwork?.({
				projectId,
				designId: design.id,
				format,
				quality: 0.92,
				data: await blob.arrayBuffer(),
				suggestedName: cleanName(design.name),
			});
			if (result?.success) toast.success(`Artwork saved to ${result.path}`);
			else if (!result?.canceled) throw new Error(result?.message ?? result?.error);
		} catch (error) {
			toast.error("Artwork export failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(null);
		}
	};
	const exportPack = async () => {
		if (!design || !projectId) return;
		setBusy("pack");
		try {
			const outputs = [];
			for (const preset of ARTWORK_PRESETS) {
				const resized = resizeArtworkDesign(design, preset.id);
				const blob = await renderArtworkToBlob(resized, assets, "png");
				outputs.push({
					fileName: cleanName(preset.name),
					width: preset.width,
					height: preset.height,
					data: await blob.arrayBuffer(),
				});
			}
			const result = await window.electronAPI?.renderArtworkPack?.({
				projectId,
				designId: design.id,
				outputs,
			});
			if (result?.success) toast.success(`Platform pack saved to ${result.directory}`);
			else if (!result?.canceled) throw new Error(result?.message ?? result?.error);
		} catch (error) {
			toast.error("Platform pack failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(null);
		}
	};
	const createOpeningCardVariant = async () => {
		if (!design || !projectId || !document) return;
		setBusy("opening-card");
		try {
			const blob = await renderArtworkToBlob(design, assets, "png");
			const encoded = await window.electronAPI?.createArtworkOpeningCard?.({
				projectId,
				designId: design.id,
				durationSec: openingDuration,
				data: await blob.arrayBuffer(),
			});
			if (!encoded?.success || !encoded.path) {
				throw new Error(encoded?.error ?? encoded?.message ?? "Opening card could not be encoded.");
			}
			const source = structuredClone(document);
			const store = useProjectStore.getState();
			const shell = await store.createProject(`${document.project.title} · opening card`);
			const imported = await useProjectStore
				.getState()
				.importProjectMedia("files", [encoded.path], ["video"]);
			const cardAssetId = imported.items.find((item) => item.success)?.assetId;
			const current = useProjectStore.getState().document;
			const cardAsset = current?.assets.find((item) => item.id === cardAssetId);
			if (!cardAsset) throw new Error("The opening-card media could not be imported.");
			const variant = buildOpeningCardVariantDocument(
				source,
				shell.project,
				cardAsset,
				encoded.durationSec ?? openingDuration,
				design.id,
			);
			if (!(await useProjectStore.getState().saveDocument(variant, { history: false }))) {
				throw new Error("The linked opening-card project could not be saved.");
			}
			toast.success("Separate opening-card project created", {
				description: "The original video project was not changed.",
			});
		} catch (error) {
			toast.error("Opening-card variant failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(null);
		}
	};
	if (!document || !projectId)
		return (
			<div className={styles.root}>
				<div className={styles.stage}>Open a project to create artwork.</div>
			</div>
		);
	return (
		<div className={styles.root}>
			<aside className={styles.panel}>
				<h2 className={styles.heading}>Artwork Studio</h2>
				<p className={styles.subtle}>
					Local thumbnails and covers. Suggestions never change your video.
				</p>
				<div className={styles.section}>
					<div className={styles.sectionTitle}>
						Platform presets <LayoutTemplate size={14} />
					</div>
					<div className={styles.grid}>
						{ARTWORK_PRESETS.map((preset) => (
							<button
								className={styles.card}
								type="button"
								key={preset.id}
								onClick={() => void createDesign(preset.id)}
							>
								<strong>{preset.name}</strong>
								<small>
									{preset.width}×{preset.height}
								</small>
							</button>
						))}
					</div>
				</div>
				<div className={styles.section}>
					<div className={styles.sectionTitle}>
						Designs <Plus size={14} />
					</div>
					{document.artworkDesigns.map((item) => (
						<button
							type="button"
							className={styles.card}
							data-selected={item.id === design?.id}
							key={item.id}
							onClick={() => setDesignId(item.id)}
						>
							<strong>{item.name}</strong>
							<small>Revision {item.revision}</small>
						</button>
					))}
				</div>
				<div className={styles.section}>
					<div className={styles.sectionTitle}>
						Source images <FileImage size={14} />
					</div>
					<div className={styles.row}>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy}
							onClick={() => void importImage("files")}
						>
							<FileImage size={13} /> Files
						</button>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy}
							onClick={() => void importImage("photos")}
						>
							<Images size={13} /> Photos
						</button>
					</div>
					<div className={styles.row}>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy || !document.project.primaryAssetId}
							onClick={() => void generateFrames(false)}
						>
							Suggest frames
						</button>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy || !document.project.primaryAssetId}
							onClick={() => void generateFrames(true)}
						>
							Capture playhead
						</button>
					</div>
					<div className={styles.grid}>
						{candidates.map((item) => (
							<button
								type="button"
								className={styles.card}
								key={item.id}
								onClick={() => void applyFrame(item)}
							>
								<img
									className={styles.thumb}
									alt={`Frame at ${item.timeSec.toFixed(1)} seconds`}
									src={toFileUrl(item.path)}
								/>
								<small>
									{item.timeSec.toFixed(1)}s · {Math.round(item.score * 100)}%
								</small>
							</button>
						))}
					</div>
				</div>
				<div className={styles.section}>
					<div className={styles.sectionTitle}>
						Local AI layouts <Sparkles size={14} />
					</div>
					<label className={styles.field}>
						Instructions
						<textarea
							value={instructions}
							onChange={(e) => setInstructions(e.target.value)}
							placeholder="Optional tone or headline direction"
						/>
					</label>
					<button
						className={`${styles.button} ${styles.primary}`}
						type="button"
						disabled={!design || !!busy}
						onClick={() => void suggest()}
					>
						<Sparkles size={13} /> Propose 3 variants
					</button>
					{suggestions.map((item) => (
						<div className={styles.suggestion} key={item.id}>
							<strong>{item.headline}</strong>
							<p>
								{item.evidence} · {Math.round(item.confidence * 100)}%
							</p>
							<button className={styles.button} type="button" onClick={() => applySuggestion(item)}>
								Apply as one undoable edit
							</button>
						</div>
					))}
				</div>
			</aside>
			<main className={styles.canvasArea}>
				<div className={styles.toolbar}>
					<div className={styles.row}>
						<button className={styles.button} type="button" onClick={() => setShowSafe((v) => !v)}>
							Safe areas
						</button>
						<button
							className={styles.button}
							type="button"
							onClick={() => setShowGuides((v) => !v)}
						>
							Guides
						</button>
						<button
							className={styles.button}
							type="button"
							disabled={!design?.revisions.length}
							onClick={() => setShowPrevious((value) => !value)}
						>
							{showPrevious ? "Show current" : "Compare previous"}
						</button>
						<select value={mock} onChange={(e) => setMock(e.target.value as typeof mock)}>
							<option value="canvas">Canvas</option>
							<option value="phone">Phone preview</option>
							<option value="feed">Feed preview</option>
							<option value="search">Search preview</option>
						</select>
					</div>
					<div className={styles.row}>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy}
							onClick={() => void exportOne("png")}
						>
							<Download size={13} /> PNG
						</button>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy}
							onClick={() => void exportOne("jpeg")}
						>
							JPEG
						</button>
						<button
							className={`${styles.button} ${styles.primary}`}
							type="button"
							disabled={!design || !!busy}
							onClick={() => void exportPack()}
						>
							Platform pack
						</button>
						<label className={styles.durationField}>
							Opening card
							<select
								value={openingDuration}
								onChange={(event) => setOpeningDuration(Number(event.target.value))}
							>
								<option value={1}>1s</option>
								<option value={2}>2s</option>
								<option value={3}>3s</option>
							</select>
						</label>
						<button
							className={styles.button}
							type="button"
							disabled={!design || !!busy}
							onClick={() => void createOpeningCardVariant()}
						>
							Add to copy
						</button>
					</div>
				</div>
				<div className={styles.stage} ref={viewport}>
					{design ? (
						<div className={mock !== "canvas" ? styles.mock : undefined} data-mock={mock}>
							{mock !== "canvas" ? (
								<span className={styles.mockLabel}>
									{mock === "phone"
										? "Phone cover preview"
										: mock === "feed"
											? "Social feed preview"
											: "YouTube search preview"}
								</span>
							) : null}
							<div
								className={styles.canvas}
								data-readonly={showPrevious}
								style={{
									width: design.width * scale,
									height: design.height * scale,
									background: design.background.value,
								}}
								onPointerDown={() => setSelectedLayerId(null)}
							>
								{displayLayers?.map((layer) => (
									<LayerView
										key={layer.id}
										layer={layer}
										asset={layer.type === "image" ? assetMap.get(layer.assetId) : undefined}
										scale={scale}
										selected={layer.id === selectedLayerId}
										onSelect={() => setSelectedLayerId(layer.id)}
										onCommit={commitLayer}
									/>
								))}
								{showSafe
									? (() => {
											const safe = getArtworkPreset(design.safeAreaPreset).safeArea;
											return (
												<div
													className={styles.safe}
													style={{
														left: `${safe.left * 100}%`,
														right: `${safe.right * 100}%`,
														top: `${safe.top * 100}%`,
														bottom: `${safe.bottom * 100}%`,
													}}
												/>
											);
										})()
									: null}
								{showGuides ? (
									<>
										<span className={styles.guideX} />
										<span className={styles.guideY} />
									</>
								) : null}
							</div>
						</div>
					) : (
						<div>
							<h2>Create your first artwork</h2>
							<p className={styles.subtle}>
								Choose any platform preset. The video project remains unchanged.
							</p>
						</div>
					)}
				</div>
				<div className={styles.footer}>
					<span>
						{design
							? `${design.width}×${design.height} · ${getArtworkPreset(design.presetId).platform}`
							: "No design selected"}
					</span>
					<span>
						{showPrevious
							? "Previous revision preview · read-only"
							: busy
								? `Working: ${busy}…`
								: "Local-only · review before export"}
					</span>
				</div>
			</main>
			<aside className={`${styles.panel} ${styles.panelRight}`}>
				<h2 className={styles.heading}>Layers</h2>
				{design ? (
					<div className={styles.section}>
						<div className={styles.sectionTitle}>Canvas background</div>
						<div className={styles.row}>
							{[
								["Midnight", "linear-gradient(135deg,#111827,#2563eb)"],
								["Sunset", "linear-gradient(135deg,#7c2d12,#f97316,#facc15)"],
								["Studio", "linear-gradient(135deg,#020617,#334155)"],
							].map(([label, value]) => (
								<button
									className={styles.button}
									type="button"
									key={label}
									onClick={() =>
										void persist(
											{ ...design, background: { kind: "gradient", value } },
											`Use ${label} background`,
										)
									}
								>
									{label}
								</button>
							))}
						</div>
						<label className={styles.field}>
							Solid colour
							<input
								type="color"
								value={
									design.background.kind === "solid"
										? design.background.value.slice(0, 7)
										: "#111827"
								}
								onChange={(event) =>
									setDesign({
										...design,
										background: { kind: "solid", value: event.target.value },
									})
								}
								onBlur={() => design && void persist(design, "Change canvas background")}
							/>
						</label>
					</div>
				) : null}
				<div className={styles.row}>
					<button
						className={styles.button}
						type="button"
						disabled={!design}
						onClick={() =>
							design &&
							addLayer({
								id: createId("artlayer"),
								name: "Text",
								type: "text",
								text: "New text",
								x: design.width * 0.08,
								y: design.height * 0.12,
								width: design.width * 0.7,
								height: design.height * 0.2,
								rotation: 0,
								opacity: 1,
								visible: true,
								zIndex: 20,
								fontFamily: "Inter",
								fontSize: Math.max(52, design.width * 0.06),
								fontWeight: 800,
								color: "#ffffff",
								align: "left",
								strokeColor: "#000000",
								strokeWidth: 0,
								shadowColor: "#00000099",
								shadowBlur: 12,
							})
						}
					>
						<Type size={13} /> Text
					</button>
					<button
						className={styles.button}
						type="button"
						disabled={!design}
						onClick={() =>
							design &&
							addLayer({
								id: createId("artlayer"),
								name: "Shape",
								type: "shape",
								shape: "rounded-rectangle",
								x: design.width * 0.1,
								y: design.height * 0.65,
								width: design.width * 0.45,
								height: design.height * 0.18,
								rotation: 0,
								opacity: 0.9,
								visible: true,
								zIndex: 10,
								fill: "#111827",
								stroke: "#ffffff",
								strokeWidth: 0,
								cornerRadius: 32,
							})
						}
					>
						Shape
					</button>
					<button
						className={styles.button}
						type="button"
						disabled={!design}
						onClick={() =>
							design &&
							addLayer({
								id: createId("artlayer"),
								name: "Icon",
								type: "icon",
								icon: "play",
								x: design.width * 0.8,
								y: design.height * 0.1,
								width: design.width * 0.1,
								height: design.width * 0.1,
								rotation: 0,
								opacity: 1,
								visible: true,
								zIndex: 30,
								color: "#ffffff",
								background: "#ef4444",
							})
						}
					>
						Icon
					</button>
					<button
						className={styles.button}
						type="button"
						disabled={!design}
						onClick={() =>
							design &&
							addLayer({
								id: createId("artlayer"),
								name: "Emoji",
								type: "text",
								text: "✨",
								x: design.width * 0.76,
								y: design.height * 0.16,
								width: design.width * 0.16,
								height: design.width * 0.16,
								rotation: 0,
								opacity: 1,
								visible: true,
								zIndex: 30,
								fontFamily: "Arial",
								fontSize: Math.max(64, design.width * 0.1),
								fontWeight: 400,
								color: "#ffffff",
								align: "center",
								strokeColor: "#000000",
								strokeWidth: 0,
								shadowColor: "#00000066",
								shadowBlur: 8,
							})
						}
					>
						<Smile size={13} /> Emoji
					</button>
				</div>
				<div className={styles.section}>
					{design?.layers
						.slice()
						.sort((a, b) => b.zIndex - a.zIndex)
						.map((layer) => (
							<button
								type="button"
								className={styles.card}
								data-selected={layer.id === selectedLayerId}
								key={layer.id}
								onClick={() => setSelectedLayerId(layer.id)}
							>
								<strong>{layer.name}</strong>
								<small>{layer.type}</small>
							</button>
						))}
				</div>
				{selectedLayer && design ? (
					<div className={styles.section}>
						<div className={styles.sectionTitle}>Selected layer</div>
						<label className={styles.field}>
							Rotation · {Math.round(selectedLayer.rotation)}°
							<input
								type="range"
								min={-180}
								max={180}
								value={selectedLayer.rotation}
								onChange={(event) =>
									patchLayer(selectedLayer.id, { rotation: Number(event.target.value) })
								}
								onPointerUp={() => design && void persist(design, "Rotate layer")}
							/>
						</label>
						{selectedLayer.type === "text" ? (
							<>
								<label className={styles.field}>
									Text
									<textarea
										value={selectedLayer.text}
										onChange={(e) => patchLayer(selectedLayer.id, { text: e.target.value })}
										onBlur={() => design && void persist(design, `Edit ${selectedLayer.name}`)}
									/>
								</label>
								<label className={styles.field}>
									Font
									<select
										value={selectedLayer.fontFamily}
										onChange={(e) => commitLayer({ ...selectedLayer, fontFamily: e.target.value })}
									>
										<option>Inter</option>
										<option>Arial</option>
										<option>Georgia</option>
										<option>Impact</option>
									</select>
								</label>
								<label className={styles.field}>
									Weight
									<select
										value={selectedLayer.fontWeight}
										onChange={(event) =>
											commitLayer({ ...selectedLayer, fontWeight: Number(event.target.value) })
										}
									>
										<option value={400}>Regular</option>
										<option value={600}>Semibold</option>
										<option value={700}>Bold</option>
										<option value={800}>Extra bold</option>
										<option value={900}>Black</option>
									</select>
								</label>
								<label className={styles.field}>
									Font size
									<input
										type="range"
										min={24}
										max={600}
										value={selectedLayer.fontSize}
										onChange={(e) =>
											patchLayer(selectedLayer.id, { fontSize: Number(e.target.value) })
										}
										onPointerUp={() => design && void persist(design, "Resize text")}
									/>
								</label>
								<label className={styles.field}>
									Text colour
									<input
										type="color"
										value={selectedLayer.color.slice(0, 7)}
										onChange={(e) => patchLayer(selectedLayer.id, { color: e.target.value })}
										onBlur={() => design && void persist(design, "Change text colour")}
									/>
								</label>
								<label className={styles.field}>
									Stroke · {selectedLayer.strokeWidth.toFixed(1)}px
									<input
										type="range"
										min={0}
										max={24}
										step={0.5}
										value={selectedLayer.strokeWidth}
										onChange={(event) =>
											patchLayer(selectedLayer.id, { strokeWidth: Number(event.target.value) })
										}
										onPointerUp={() => design && void persist(design, "Change text stroke")}
									/>
								</label>
								<label className={styles.field}>
									Shadow · {Math.round(selectedLayer.shadowBlur)}px
									<input
										type="range"
										min={0}
										max={100}
										value={selectedLayer.shadowBlur}
										onChange={(event) =>
											patchLayer(selectedLayer.id, { shadowBlur: Number(event.target.value) })
										}
										onPointerUp={() => design && void persist(design, "Change text shadow")}
									/>
								</label>
							</>
						) : null}
						{selectedLayer.type === "image" ? (
							<>
								<button
									className={styles.button}
									type="button"
									disabled={!!busy}
									onClick={() => void cutoutSelectedImage()}
								>
									{selectedLayer.cutout ? "Recreate local cutout" : "Remove background locally"}
								</button>
								<label className={styles.field}>
									Crop horizontally
									<input
										type="range"
										min={0}
										max={1}
										step={0.01}
										value={selectedLayer.cropX}
										onChange={(e) =>
											patchLayer(selectedLayer.id, { cropX: Number(e.target.value) })
										}
										onPointerUp={() => design && void persist(design, "Crop image")}
									/>
								</label>
								<label className={styles.field}>
									Crop vertically
									<input
										type="range"
										min={0}
										max={1}
										step={0.01}
										value={selectedLayer.cropY}
										onChange={(e) =>
											patchLayer(selectedLayer.id, { cropY: Number(e.target.value) })
										}
										onPointerUp={() => design && void persist(design, "Crop image")}
									/>
								</label>
								<label className={styles.field}>
									Blur
									<input
										type="range"
										min={0}
										max={80}
										value={selectedLayer.blur}
										onChange={(e) => patchLayer(selectedLayer.id, { blur: Number(e.target.value) })}
										onPointerUp={() => design && void persist(design, "Blur image")}
									/>
								</label>
								<label className={styles.field}>
									Fit
									<select
										value={selectedLayer.fit}
										onChange={(e) =>
											commitLayer({
												...selectedLayer,
												fit: e.target.value as "cover" | "contain" | "fill",
											})
										}
									>
										<option value="cover">Cover</option>
										<option value="contain">Contain</option>
										<option value="fill">Fill</option>
									</select>
								</label>
							</>
						) : null}
						{selectedLayer.type === "shape" ? (
							<>
								<label className={styles.field}>
									Shape
									<select
										value={selectedLayer.shape}
										onChange={(event) =>
											commitLayer({
												...selectedLayer,
												shape: event.target.value as typeof selectedLayer.shape,
											})
										}
									>
										<option value="rectangle">Rectangle</option>
										<option value="rounded-rectangle">Rounded</option>
										<option value="ellipse">Ellipse</option>
										<option value="line">Line</option>
									</select>
								</label>
								<label className={styles.field}>
									Fill colour
									<input
										type="color"
										value={selectedLayer.fill.slice(0, 7)}
										onChange={(event) => patchLayer(selectedLayer.id, { fill: event.target.value })}
										onBlur={() => design && void persist(design, "Change shape colour")}
									/>
								</label>
							</>
						) : null}
						{selectedLayer.type === "icon" ? (
							<>
								<label className={styles.field}>
									Bundled icon
									<select
										value={selectedLayer.icon}
										onChange={(event) =>
											commitLayer({ ...selectedLayer, icon: event.target.value })
										}
									>
										<option value="play">Play</option>
										<option value="check">Check</option>
										<option value="arrow">Arrow</option>
										<option value="star">Star</option>
									</select>
								</label>
								<label className={styles.field}>
									Icon colour
									<input
										type="color"
										value={selectedLayer.color.slice(0, 7)}
										onChange={(event) =>
											patchLayer(selectedLayer.id, { color: event.target.value })
										}
										onBlur={() => design && void persist(design, "Change icon colour")}
									/>
								</label>
							</>
						) : null}
						<label className={styles.field}>
							Opacity
							<input
								type="range"
								min={0}
								max={1}
								step={0.01}
								value={selectedLayer.opacity}
								onChange={(e) => patchLayer(selectedLayer.id, { opacity: Number(e.target.value) })}
								onPointerUp={() => design && void persist(design, "Change opacity")}
							/>
						</label>
						<button
							className={styles.button}
							type="button"
							onClick={() =>
								addLayer({
									...selectedLayer,
									id: createId("artlayer"),
									name: `${selectedLayer.name} copy`,
									x: selectedLayer.x + 24,
									y: selectedLayer.y + 24,
								})
							}
						>
							<Copy size={13} /> Duplicate
						</button>
						<div className={styles.row}>
							<button
								className={styles.button}
								type="button"
								onClick={() => moveLayer(selectedLayer.id, 1)}
							>
								<ArrowUp size={13} /> Forward
							</button>
							<button
								className={styles.button}
								type="button"
								onClick={() => moveLayer(selectedLayer.id, -1)}
							>
								<ArrowDown size={13} /> Back
							</button>
							<button
								className={styles.button}
								type="button"
								onClick={() => removeLayer(selectedLayer.id)}
							>
								<Trash2 size={13} /> Delete
							</button>
						</div>
					</div>
				) : null}
				{design
					? artworkTextWarnings(design).map((warning) => (
							<div className={styles.warning} key={warning}>
								{warning}
							</div>
						))
					: null}
				<p className={styles.subtle}>
					Use ⌘Z/⌘⇧Z for project-wide undo and redo. Every suggestion is one undoable revision.
				</p>
			</aside>
		</div>
	);
}
