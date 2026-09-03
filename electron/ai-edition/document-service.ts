// DocumentService — main-process owner of v3 AxcutDocument projects.
// Persists one .openscreen JSON per project under userData/projects/ (the file
// carries its own `schemaVersion`, so migration keys off the content, not the
// extension). Older builds wrote these same documents as `.axcut`; those are
// renamed to `.openscreen` on first access. Slim port of
// axcut's apps/server/src/services/document-service.ts (no separate paths.ts —
// uses app.getPath("userData") directly; no Python probe_media — assets carry
// only path metadata, duration is filled in by the renderer).
//
// ponytail: Phase 1 surface area is intentionally narrow (list / get / create
// / save / addAsset / removeAsset). ops/history/agent runtime land in Phase 6.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createId } from "../../src/lib/ai-edition/document/ids";
import { removeClip } from "../../src/lib/ai-edition/document/timeline";
import {
	type AxcutAsset,
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
	migrateRawDocumentToCurrent,
} from "../../src/lib/ai-edition/schema";
import type {
	AiEditionProjectMediaImportItem,
	AiEditionProjectMediaImportRequest,
	AiEditionProjectMediaImportResult,
} from "../../src/native/contracts";
import {
	importManagedProjectMedia,
	type ProjectMediaImportProgress,
} from "../media/projectMediaImport";
import { relinkProjectMedia } from "../media/projectMediaRelinker";

const PROJECT_FILE_EXTENSION = ".openscreen";
// Older builds stored these same v3/v4 AxcutDocuments under `.axcut`. We read
// them for back-compat and rename them to PROJECT_FILE_EXTENSION on access.
const LEGACY_PROJECT_FILE_EXTENSION = ".axcut";

export interface ProjectSummary {
	id: string;
	title: string;
	updatedAt: string;
	assetCount: number;
}

export interface AddAssetInput {
	path: string;
	label?: string;
}

export type ProjectSnapshotReason = "autosave" | "manual" | "ai" | "restore";

export interface ProjectSnapshotSummary {
	id: string;
	projectId: string;
	createdAt: string;
	label: string;
	reason: ProjectSnapshotReason;
	sizeBytes: number;
}

interface ProjectSnapshotFile extends ProjectSnapshotSummary {
	version: 1;
	document: AxcutDocument;
}

export interface PortableProjectResult {
	path: string;
	mediaCount: number;
	manifestPath: string;
}

const AUTOSAVE_SNAPSHOT_INTERVAL_MS = 60_000;
const MAX_AUTOSAVE_SNAPSHOTS = 40;

export class DocumentNotFoundError extends Error {
	constructor(public readonly projectId: string) {
		super(`Project not found: ${projectId}`);
		this.name = "DocumentNotFoundError";
	}
}

export class ProjectFileError extends Error {
	constructor(
		message: string,
		public readonly projectId?: string,
	) {
		super(message);
		this.name = "ProjectFileError";
	}
}

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
	".mp4",
	".mov",
	".m4v",
	".webm",
	".mkv",
	".avi",
	".wmv",
]);

function isSupportedVideoPath(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return SUPPORTED_VIDEO_EXTENSIONS.has(ext);
}

function safeProjectId(raw: string): string {
	// ponytail: project ids are uuid-prefixed strings (e.g. "proj_<uuid>"). Reject
	// anything that smells like path traversal before we ever touch the disk.
	if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
		throw new ProjectFileError(`Invalid project id: ${raw}`);
	}
	return raw;
}

async function removePhotosPickerTransfer(filePath: string): Promise<void> {
	const root = path.resolve(os.tmpdir(), "OpenScreenPhotosPicker");
	const resolved = path.resolve(filePath);
	const parent = path.dirname(resolved);
	if (
		parent === root ||
		!resolved.startsWith(`${root}${path.sep}`) ||
		parent === path.dirname(root)
	) {
		return;
	}
	await fs.rm(parent, { recursive: true, force: true }).catch(() => undefined);
}

// ponytail: load-time migration hook. The on-disk file may carry any supported
// `schemaVersion` (v2 EditorProjectData handled separately by
// `migrateProjectDataToAxcutDocument`; v3 / v4 AxcutDocuments handled here).
// `documentSchema.parse` is now a pure current-schema validator — every JSON-read path
// (list, get, future bulk-export) must run the upgrader chain first via this
// helper so the in-memory parse is a single `z.literal(6)` + shape check.
// `getProject` spells the same two steps out inline because it relinks moved
// media between them; keep the order (upgrade, then validate) in step.
function parseLoadedDocument(raw: string): AxcutDocument {
	return documentSchema.parse(migrateRawDocumentToCurrent(JSON.parse(raw)));
}

/**
 * Windows fails a rename onto an open file with EPERM/EBUSY: an indexer, an
 * antivirus or a backup agent can hold the destination for a few milliseconds
 * after we last touched it. The write itself is sound, so retry briefly rather
 * than surface a save error the user cannot act on. POSIX renames don't hit this
 * and take the first attempt.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
	const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(from, to);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code ?? "";
			if (attempt >= 5 || !RETRYABLE.has(code)) throw error;
			await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
		}
	}
}

export class DocumentService {
	private readonly projectsRoot: string;
	private readonly mediaRegistryDir: string;
	private readonly portableProjectsRoot: string;
	private legacyMigrationDone = false;
	/** Tail of the in-flight save chain per project id — see writeProject. */
	private readonly writeQueues = new Map<string, Promise<void>>();
	/** Avoid re-reading and validating up to 40 large snapshots on every keystroke-save. */
	private readonly lastAutosaveAt = new Map<string, number>();

	// `mediaRegistryDir` is where the media-links registry file lives
	// (RECORDINGS_DIR in production) — see getProject. Injected for the same
	// reason as `projectsRoot`: this module stays free of any `electron` import.
	constructor(projectsRoot: string, mediaRegistryDir: string, portableProjectsRoot?: string) {
		this.projectsRoot = projectsRoot;
		this.mediaRegistryDir = mediaRegistryDir;
		this.portableProjectsRoot =
			portableProjectsRoot ?? path.join(projectsRoot, "Portable Projects");
	}

	getManagedProjectDirectory(projectId: string): string {
		return path.join(this.projectsRoot, safeProjectId(projectId));
	}

	async ensureProjectsDir(): Promise<void> {
		await fs.mkdir(this.projectsRoot, { recursive: true });
		await this.migrateLegacyExtensions();
	}

	// One-time-per-process pass renaming any legacy `.axcut` project files to
	// `.openscreen`. The document bytes are identical (same schemaVersion), so
	// this is a pure rename — no content migration involved.
	private async migrateLegacyExtensions(): Promise<void> {
		if (this.legacyMigrationDone) return;
		this.legacyMigrationDone = true;
		let entries: string[];
		try {
			entries = await fs.readdir(this.projectsRoot);
		} catch {
			return;
		}
		await Promise.all(
			entries
				.filter((name) => name.endsWith(LEGACY_PROJECT_FILE_EXTENSION))
				.map(async (name) => {
					const from = path.join(this.projectsRoot, name);
					const base = name.slice(0, -LEGACY_PROJECT_FILE_EXTENSION.length);
					const to = path.join(this.projectsRoot, `${base}${PROJECT_FILE_EXTENSION}`);
					try {
						// If a `.openscreen` already exists for this id it's authoritative;
						// drop the stale `.axcut`. Otherwise rename the legacy file across.
						await fs.access(to);
						await fs.unlink(from);
					} catch {
						await fs
							.rename(from, to)
							.catch((err) =>
								console.warn(`[ai-edition] failed to migrate ${from} -> ${to}:`, err),
							);
					}
				}),
		);
	}

	private fileFor(projectId: string): string {
		const safe = safeProjectId(projectId);
		return path.join(this.projectsRoot, `${safe}${PROJECT_FILE_EXTENSION}`);
	}

	private legacyFileFor(projectId: string): string {
		const safe = safeProjectId(projectId);
		return path.join(this.projectsRoot, `${safe}${LEGACY_PROJECT_FILE_EXTENSION}`);
	}

	private snapshotsDirFor(projectId: string): string {
		return path.join(this.projectsRoot, ".recovery", safeProjectId(projectId));
	}

	private snapshotFileFor(projectId: string, snapshotId: string): string {
		return path.join(this.snapshotsDirFor(projectId), `${safeProjectId(snapshotId)}.json`);
	}

	async listProjects(): Promise<ProjectSummary[]> {
		await this.ensureProjectsDir();
		const entries = await fs.readdir(this.projectsRoot);
		// ensureProjectsDir (above) already migrated any legacy `.axcut` files.
		const projectFiles = entries.filter((name) => name.endsWith(PROJECT_FILE_EXTENSION));
		const summaries: ProjectSummary[] = [];
		for (const name of projectFiles) {
			const filePath = path.join(this.projectsRoot, name);
			try {
				const raw = await fs.readFile(filePath, "utf8");
				const parsed = parseLoadedDocument(raw);
				summaries.push({
					id: parsed.project.id,
					title: parsed.project.title,
					updatedAt: parsed.project.updatedAt,
					assetCount: parsed.assets.length,
				});
			} catch (error) {
				// ponytail: skip unreadable files rather than failing the whole list.
				// A future migration pass can recover them.
				console.warn(`[ai-edition] failed to read ${filePath}:`, error);
			}
		}
		summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		return summaries;
	}

	async getProject(projectId: string): Promise<AxcutDocument> {
		// Prefer the canonical `.openscreen` file, falling back to a not-yet-migrated
		// legacy `.axcut` so a project opened before its migration pass still loads.
		let raw: string;
		try {
			raw = await fs.readFile(this.fileFor(projectId), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
				throw new ProjectFileError(
					`Failed to read project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
					projectId,
				);
			}
			try {
				raw = await fs.readFile(this.legacyFileFor(projectId), "utf8");
			} catch (legacyError) {
				if ((legacyError as NodeJS.ErrnoException)?.code === "ENOENT") {
					throw new DocumentNotFoundError(projectId);
				}
				throw new ProjectFileError(
					`Failed to read project ${projectId}: ${legacyError instanceof Error ? legacyError.message : String(legacyError)}`,
					projectId,
				);
			}
		}
		// Relink here rather than in the .openscreen import handlers, because this
		// is the one place every open funnels through — the project picker, the
		// agent, and the auto-load-last-project effect on launch. A document whose
		// media moved (or that was authored on another machine, issue #212) is
		// otherwise re-read as broken on every subsequent open, and media that
		// moves after the import is never noticed at all. The relink is applied to
		// the upgraded JSON so `documentSchema.parse` still validates what we hand
		// back, and it is not persisted from here: the renderer saves the document
		// it was given, as it does for any other load-time repair.
		try {
			const migrated = migrateRawDocumentToCurrent(JSON.parse(raw));
			return documentSchema.parse(await relinkProjectMedia(migrated, this.mediaRegistryDir));
		} catch (error) {
			// A torn/manual-corrupted canonical file must not strand every valid version
			// behind it. Return the newest validated recovery point without overwriting
			// the damaged file; the Recovery UI lets the user explicitly restore it.
			const snapshots = await this.listSnapshots(projectId);
			for (const snapshot of snapshots) {
				try {
					const recovered = await this.readSnapshot(projectId, snapshot.id);
					console.warn(
						`[ai-edition] project ${projectId} is unreadable; opened recovery point ${snapshot.id}`,
						error,
					);
					return documentSchema.parse(
						await relinkProjectMedia(recovered.document, this.mediaRegistryDir),
					);
				} catch (snapshotError) {
					console.warn(`[ai-edition] invalid recovery point ${snapshot.id}:`, snapshotError);
				}
			}
			throw new ProjectFileError(
				`Project ${projectId} is damaged and no valid recovery point is available.`,
				projectId,
			);
		}
	}

	async createProject(title: string): Promise<AxcutDocument> {
		await this.ensureProjectsDir();
		const projectId = createId("proj");
		const doc = createEmptyDocument({
			projectId,
			title: title?.trim() || "Untitled Project",
		});
		await this.writeProject(doc);
		return doc;
	}

	async saveProject(document: AxcutDocument): Promise<AxcutDocument> {
		const parsed = documentSchema.parse(document);
		const stamped: AxcutDocument = {
			...parsed,
			project: { ...parsed.project, updatedAt: new Date().toISOString() },
		};
		await this.writeProject(stamped);
		return stamped;
	}

	async deleteProject(projectId: string): Promise<void> {
		// Remove the canonical file and any lingering legacy `.axcut` for this id.
		for (const filePath of [this.fileFor(projectId), this.legacyFileFor(projectId)]) {
			try {
				await fs.unlink(filePath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
					throw error;
				}
			}
		}
		await fs.rm(this.snapshotsDirFor(projectId), { recursive: true, force: true });
		this.lastAutosaveAt.delete(projectId);
	}

	async createSnapshot(
		projectId: string,
		label = "Manual restore point",
		reason: ProjectSnapshotReason = "manual",
	): Promise<ProjectSnapshotSummary> {
		const document = await this.getProject(projectId);
		return this.writeSnapshot(document, label, reason);
	}

	async listSnapshots(projectId: string): Promise<ProjectSnapshotSummary[]> {
		const directory = this.snapshotsDirFor(projectId);
		let entries: string[];
		try {
			entries = await fs.readdir(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
			throw error;
		}
		const summaries: ProjectSnapshotSummary[] = [];
		for (const entry of entries.filter((name) => name.endsWith(".json"))) {
			try {
				const parsed = JSON.parse(await fs.readFile(path.join(directory, entry), "utf8")) as
					| ProjectSnapshotFile
					| undefined;
				if (!parsed || parsed.version !== 1 || parsed.projectId !== projectId) continue;
				documentSchema.parse(parsed.document);
				summaries.push({
					id: parsed.id,
					projectId: parsed.projectId,
					createdAt: parsed.createdAt,
					label: parsed.label,
					reason: parsed.reason,
					sizeBytes: parsed.sizeBytes,
				});
			} catch (error) {
				console.warn(`[ai-edition] ignored invalid recovery point ${entry}:`, error);
			}
		}
		return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async restoreSnapshot(projectId: string, snapshotId: string): Promise<AxcutDocument> {
		const snapshot = await this.readSnapshot(projectId, snapshotId);
		// Restoring is itself reversible: preserve what the user is leaving before
		// replacing the canonical project.
		try {
			await this.createSnapshot(projectId, "Before recovery restore", "restore");
		} catch (error) {
			console.warn("[ai-edition] could not create pre-restore snapshot:", error);
		}
		const restored: AxcutDocument = {
			...snapshot.document,
			project: { ...snapshot.document.project, updatedAt: new Date().toISOString() },
		};
		await this.writeProject(restored, false);
		return restored;
	}

	async collectProjectMedia(projectId: string): Promise<PortableProjectResult> {
		const document = await this.getProject(projectId);
		await fs.mkdir(this.portableProjectsRoot, { recursive: true });
		const title = sanitizeFileName(document.project.title) || "OpenScreen Project";
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const finalPath = path.join(this.portableProjectsRoot, `${title} ${stamp}`);
		const temporaryPath = `${finalPath}.tmp-${process.pid}-${createId("bundle")}`;
		const mediaDir = path.join(temporaryPath, "Media");
		await fs.mkdir(mediaDir, { recursive: true });

		const copied = new Map<string, string>();
		const manifestMedia: Array<{
			sourceName: string;
			bundledPath: string;
			sha256: string;
			sizeBytes: number;
		}> = [];
		const copyMedia = async (sourcePath: string): Promise<string> => {
			const absolute = path.resolve(sourcePath);
			const existing = copied.get(absolute);
			if (existing) return existing;
			const stats = await fs.stat(absolute);
			if (!stats.isFile())
				throw new ProjectFileError(`Media is not a file: ${path.basename(absolute)}`, projectId);
			const base = sanitizeFileName(path.basename(absolute)) || "media";
			let bundledName = base;
			let suffix = 2;
			while ([...copied.values()].some((value) => path.basename(value) === bundledName)) {
				const ext = path.extname(base);
				bundledName = `${path.basename(base, ext)}-${suffix++}${ext}`;
			}
			const target = path.join(mediaDir, bundledName);
			await fs.copyFile(absolute, target);
			const copiedStats = await fs.stat(target);
			manifestMedia.push({
				sourceName: path.basename(absolute),
				bundledPath: path.join("Media", bundledName),
				sha256: await hashFile(target),
				sizeBytes: copiedStats.size,
			});
			// The temporary directory is renamed atomically below. Persist the FINAL
			// location in the portable document so the bundle opens immediately after
			// that rename instead of pointing at a now-nonexistent `.tmp-*` path.
			const finalTarget = path.join(finalPath, "Media", bundledName);
			copied.set(absolute, finalTarget);
			return finalTarget;
		};

		try {
			const assets: AxcutAsset[] = [];
			for (const asset of document.assets) {
				const originalPath = await copyMedia(asset.originalPath);
				const proxyPath = asset.proxyPath ? await copyMedia(asset.proxyPath) : undefined;
				const cameraTrack = asset.cameraTrack?.sourcePath
					? { ...asset.cameraTrack, sourcePath: await copyMedia(asset.cameraTrack.sourcePath) }
					: asset.cameraTrack;
				assets.push({
					...asset,
					originalPath,
					...(proxyPath ? { proxyPath } : {}),
					...(asset.managedImport
						? {
								managedImport: {
									...asset.managedImport,
									managedOriginalPath: originalPath,
								},
							}
						: {}),
					cameraTrack,
				});
			}
			const artworkAssets: AxcutDocument["artworkAssets"] = [];
			for (const asset of document.artworkAssets) {
				const bundledPath = await copyMedia(asset.path);
				const originalPath = asset.originalPath ? await copyMedia(asset.originalPath) : undefined;
				artworkAssets.push({
					...asset,
					path: bundledPath,
					...(originalPath ? { originalPath } : {}),
				});
			}
			const legacy = (document.legacyEditor as Record<string, unknown> | null) ?? {};
			const backgroundMusicPath =
				typeof legacy.backgroundMusicPath === "string" && legacy.backgroundMusicPath.trim()
					? await copyMedia(legacy.backgroundMusicPath)
					: null;
			const portable: AxcutDocument = {
				...document,
				assets,
				artworkAssets,
				legacyEditor: { ...legacy, ...(backgroundMusicPath ? { backgroundMusicPath } : {}) },
			};
			const projectPath = path.join(temporaryPath, "project.openscreen");
			await fs.writeFile(projectPath, JSON.stringify(portable, null, 2), "utf8");
			const manifestPath = path.join(temporaryPath, "manifest.json");
			await fs.writeFile(
				manifestPath,
				JSON.stringify(
					{ version: 1, projectId, createdAt: new Date().toISOString(), media: manifestMedia },
					null,
					2,
				),
				"utf8",
			);
			await renameWithRetry(temporaryPath, finalPath);
			return {
				path: finalPath,
				mediaCount: manifestMedia.length,
				manifestPath: path.join(finalPath, "manifest.json"),
			};
		} catch (error) {
			await fs.rm(temporaryPath, { recursive: true, force: true });
			throw error;
		}
	}

	async addAsset(projectId: string, input: AddAssetInput): Promise<AxcutDocument> {
		const doc = await this.getProject(projectId);
		if (!input.path) {
			throw new ProjectFileError("Asset path is required.", projectId);
		}
		if (!isSupportedVideoPath(input.path)) {
			throw new ProjectFileError(
				`Unsupported video extension: ${path.extname(input.path)} (supported: ${[...SUPPORTED_VIDEO_EXTENSIONS].join(", ")})`,
				projectId,
			);
		}
		const absolutePath = path.isAbsolute(input.path) ? input.path : path.resolve(input.path);
		// P3.1 — capture the file size at import. Non-fatal: a stat failure
		// (network drive, permissions) just leaves sizeBytes undefined.
		let sizeBytes: number | undefined;
		try {
			sizeBytes = (await fs.stat(absolutePath)).size;
		} catch {
			sizeBytes = undefined;
		}
		const asset: AxcutAsset = {
			id: createId("asset"),
			kind: "video",
			label: input.label?.trim() || path.basename(absolutePath),
			originalPath: absolutePath,
			sizeBytes,
			cameraTrack: null,
		};
		const next: AxcutDocument = {
			...doc,
			assets: [...doc.assets, asset],
			project: {
				...doc.project,
				...(doc.project.primaryAssetId ? {} : { primaryAssetId: asset.id }),
				updatedAt: new Date().toISOString(),
			},
		};
		return this.saveProject(next);
	}

	async importProjectMedia(
		request: AiEditionProjectMediaImportRequest,
		options: {
			signal?: AbortSignal;
			onProgress?: (progress: ProjectMediaImportProgress) => void;
		} = {},
	): Promise<AiEditionProjectMediaImportResult> {
		let document = await this.getProject(request.projectId);
		const items: AiEditionProjectMediaImportItem[] = [];
		for (let index = 0; index < request.paths.length; index += 1) {
			const sourcePath = request.paths[index];
			try {
				const [managed] = await importManagedProjectMedia({
					jobId: request.jobId,
					projectId: request.projectId,
					projectsRoot: this.projectsRoot,
					source: request.source,
					paths: [sourcePath],
					mediaKinds: request.mediaKinds,
					signal: options.signal,
					onProgress: (progress) =>
						options.onProgress?.({
							...progress,
							itemIndex: index,
							itemCount: request.paths.length,
						}),
				});
				if (!managed)
					throw new ProjectFileError("Import produced no managed media.", request.projectId);
				if (managed.mediaKind === "video") {
					const duplicate = document.assets.find(
						(asset) => asset.managedImport?.sha256 === managed.sha256,
					);
					const asset: AxcutAsset =
						duplicate ??
						({
							id: createId("asset"),
							kind: "video",
							label: path.basename(sourcePath),
							originalPath: managed.managedPath,
							...(managed.proxyPath ? { proxyPath: managed.proxyPath } : {}),
							durationSec: managed.probe.durationSec,
							sizeBytes: managed.sizeBytes,
							video: {
								codec: managed.probe.videoCodec,
								width: managed.probe.width,
								height: managed.probe.height,
								fps: managed.probe.averageFrameRate || managed.probe.frameRate,
							},
							audio:
								managed.probe.audioTrackCount > 0
									? {
											codec: managed.probe.audioCodecs[0] ?? "unknown",
											sampleRate: 0,
											channels: 0,
										}
									: undefined,
							managedImport: {
								source: request.source,
								originalName: path.basename(sourcePath),
								importedAt: new Date().toISOString(),
								sha256: managed.sha256,
								managedOriginalPath: managed.managedPath,
								proxyStatus: managed.proxyStatus,
								probe: managed.probe,
							},
							cameraTrack: null,
						} satisfies AxcutAsset);
					if (!duplicate) {
						document = documentSchema.parse({
							...document,
							assets: [...document.assets, asset],
							project: {
								...document.project,
								...(document.project.primaryAssetId ? {} : { primaryAssetId: asset.id }),
								updatedAt: new Date().toISOString(),
							},
						});
					}
					items.push({
						sourcePath,
						success: true,
						mediaKind: "video",
						assetId: asset.id,
						managedPath: managed.managedPath,
						proxyPath: managed.proxyPath,
						proxyStatus: managed.proxyStatus,
						fingerprint: managed.sha256,
						probe: managed.probe,
						...(managed.proxyError
							? { error: `Original imported; proxy failed: ${managed.proxyError}` }
							: {}),
					});
				} else {
					const duplicate = document.artworkAssets.find((asset) => asset.sha256 === managed.sha256);
					const artworkAsset =
						duplicate ??
						({
							id: createId("art"),
							label: path.basename(sourcePath),
							path: managed.proxyPath ?? managed.managedPath,
							originalPath: managed.managedPath,
							mimeType: artworkMimeType(sourcePath),
							width: managed.probe.width,
							height: managed.probe.height,
							sha256: managed.sha256,
							source: request.source,
							createdAt: new Date().toISOString(),
						} as const);
					if (artworkAsset.width <= 0 || artworkAsset.height <= 0) {
						throw new ProjectFileError(
							`Could not read image dimensions for ${path.basename(sourcePath)}.`,
							request.projectId,
						);
					}
					if (!duplicate) {
						document = documentSchema.parse({
							...document,
							artworkAssets: [...document.artworkAssets, artworkAsset],
							project: { ...document.project, updatedAt: new Date().toISOString() },
						});
					}
					items.push({
						sourcePath,
						success: true,
						mediaKind: "artwork",
						artworkAssetId: artworkAsset.id,
						managedPath: managed.managedPath,
						proxyStatus: "not-needed",
						fingerprint: managed.sha256,
						probe: managed.probe,
					});
				}
			} catch (error) {
				items.push({
					sourcePath,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
				if (options.signal?.aborted) break;
			} finally {
				if (request.source === "photos") await removePhotosPickerTransfer(sourcePath);
			}
		}
		if (items.some((item) => item.success)) document = await this.saveProject(document);
		return { jobId: request.jobId, projectId: request.projectId, items, document };
	}

	async removeAsset(projectId: string, assetId: string): Promise<AxcutDocument> {
		const doc = await this.getProject(projectId);
		if (!doc.assets.some((a) => a.id === assetId)) {
			throw new ProjectFileError(`Asset ${assetId} not found in project ${projectId}.`, projectId);
		}
		const assets = doc.assets.filter((a) => a.id !== assetId);
		const primaryAssetId =
			doc.project.primaryAssetId === assetId
				? (assets[0]?.id ?? undefined)
				: doc.project.primaryAssetId;
		const withoutAssetClips = doc.timeline.clips
			.filter((clip) => clip.assetId === assetId)
			.reduce((current, clip) => removeClip(current, clip.id), doc);
		const next: AxcutDocument = {
			...withoutAssetClips,
			assets,
			timeline: {
				...withoutAssetClips.timeline,
				trimRanges: withoutAssetClips.timeline.trimRanges.filter((r) => r.assetId !== assetId),
			},
			project: {
				...withoutAssetClips.project,
				primaryAssetId,
				updatedAt: new Date().toISOString(),
			},
		};
		return this.saveProject(next);
	}

	/**
	 * Serialise saves per project, then write atomically.
	 *
	 * This has destroyed real project files. `fs.writeFile` opens with O_TRUNC and
	 * writes from offset 0, so two concurrent saves of the SAME project interleave
	 * onto one path: the short document lands over the long one's opening bytes and
	 * the long one's tail survives past its end. The result parses as JSON right up
	 * to the splice and then dies — the file is unreadable and the edits in it are
	 * gone. Two projects on this machine were lost exactly that way (a complete
	 * document followed by the tail of a longer, older version).
	 *
	 * Both halves are load-bearing:
	 *  - the queue makes concurrent saves of one project sequential, so a save
	 *    always writes over a settled file, never a half-written one;
	 *  - temp + rename makes each save all-or-nothing, so a crash (or a full disk)
	 *    mid-write leaves the previous document intact instead of a truncated one.
	 * The queue alone would still leave a torn file on a crash; the rename alone
	 * would still let two saves race for the same destination.
	 */
	private writeProject(doc: AxcutDocument, snapshotPrevious = true): Promise<void> {
		const projectId = doc.project.id;
		const tail = this.writeQueues.get(projectId) ?? Promise.resolve();
		// Chained on both settlements: one save failing must not cancel the next.
		const run = tail.then(
			() => this.writeProjectNow(doc, snapshotPrevious),
			() => this.writeProjectNow(doc, snapshotPrevious),
		);
		const settled = run.catch(() => undefined);
		this.writeQueues.set(projectId, settled);
		void settled.then(() => {
			// Only the tail clears the entry — a later save may already own it.
			if (this.writeQueues.get(projectId) === settled) this.writeQueues.delete(projectId);
		});
		return run;
	}

	private async writeProjectNow(doc: AxcutDocument, snapshotPrevious: boolean): Promise<void> {
		await this.ensureProjectsDir();
		const filePath = this.fileFor(doc.project.id);
		// The suffix goes AFTER the extension on purpose: listProjects matches on a
		// trailing `.openscreen`, so an interrupted write's leftover is invisible to
		// it rather than showing up as a corrupt project. Unique per write, so two
		// queues (or two processes) never share a temp path.
		const tempPath = `${filePath}.tmp-${process.pid}-${createId("w")}`;
		const json = JSON.stringify(doc, null, 2);
		if (snapshotPrevious) await this.maybeSnapshotPrevious(doc.project.id, json);

		let handle: FileHandle | undefined;
		try {
			handle = await fs.open(tempPath, "w");
			await handle.writeFile(json, "utf8");
			// Flush before the rename: without it the rename can reach the disk first
			// and a power loss leaves the new name pointing at unwritten blocks.
			await handle.sync();
		} catch (error) {
			await handle?.close().catch(() => undefined);
			await fs.unlink(tempPath).catch(() => undefined);
			throw new ProjectFileError(
				`Failed to write project ${doc.project.id}: ${error instanceof Error ? error.message : String(error)}`,
				doc.project.id,
			);
		}
		await handle.close();

		try {
			await renameWithRetry(tempPath, filePath);
		} catch (error) {
			await fs.unlink(tempPath).catch(() => undefined);
			throw new ProjectFileError(
				`Failed to save project ${doc.project.id}: ${error instanceof Error ? error.message : String(error)}`,
				doc.project.id,
			);
		}

		// A save supersedes any legacy `.axcut` for this id (ensureProjectsDir
		// usually renamed it already; this is a belt-and-braces cleanup).
		await fs.unlink(this.legacyFileFor(doc.project.id)).catch(() => undefined);
	}

	private async maybeSnapshotPrevious(projectId: string, nextJson: string): Promise<void> {
		let raw: string;
		try {
			raw = await fs.readFile(this.fileFor(projectId), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
			throw error;
		}
		if (raw === nextJson) return;
		const previous = parseLoadedDocument(raw);
		let lastAutosaveAt = this.lastAutosaveAt.get(projectId);
		if (lastAutosaveAt == null) {
			const existing = await this.listSnapshots(projectId);
			const newestAutosave = existing.find((item) => item.reason === "autosave");
			lastAutosaveAt = newestAutosave ? Date.parse(newestAutosave.createdAt) : 0;
			this.lastAutosaveAt.set(projectId, lastAutosaveAt);
		}
		if (Date.now() - lastAutosaveAt < AUTOSAVE_SNAPSHOT_INTERVAL_MS) return;
		await this.writeSnapshot(previous, "Automatic recovery point", "autosave");
		this.lastAutosaveAt.set(projectId, Date.now());
		await this.pruneAutosaveSnapshots(projectId);
	}

	private async writeSnapshot(
		document: AxcutDocument,
		label: string,
		reason: ProjectSnapshotReason,
	): Promise<ProjectSnapshotSummary> {
		const parsed = documentSchema.parse(document);
		const id = createId("snapshot");
		const createdAt = new Date().toISOString();
		const base = {
			version: 1 as const,
			id,
			projectId: parsed.project.id,
			createdAt,
			label: label.trim().slice(0, 120) || "Restore point",
			reason,
			document: parsed,
		};
		let encoded = JSON.stringify({ ...base, sizeBytes: 0 }, null, 2);
		const sizeBytes = Buffer.byteLength(encoded);
		encoded = JSON.stringify({ ...base, sizeBytes }, null, 2);
		const directory = this.snapshotsDirFor(parsed.project.id);
		await fs.mkdir(directory, { recursive: true });
		const filePath = this.snapshotFileFor(parsed.project.id, id);
		const tempPath = `${filePath}.tmp-${process.pid}-${createId("w")}`;
		await fs.writeFile(tempPath, encoded, "utf8");
		await renameWithRetry(tempPath, filePath);
		return { id, projectId: parsed.project.id, createdAt, label: base.label, reason, sizeBytes };
	}

	private async readSnapshot(projectId: string, snapshotId: string): Promise<ProjectSnapshotFile> {
		const parsed = JSON.parse(
			await fs.readFile(this.snapshotFileFor(projectId, snapshotId), "utf8"),
		) as ProjectSnapshotFile;
		if (parsed.version !== 1 || parsed.projectId !== projectId || parsed.id !== snapshotId) {
			throw new ProjectFileError("Recovery point does not belong to this project.", projectId);
		}
		return { ...parsed, document: documentSchema.parse(parsed.document) };
	}

	private async pruneAutosaveSnapshots(projectId: string): Promise<void> {
		const autosaves = (await this.listSnapshots(projectId)).filter(
			(item) => item.reason === "autosave",
		);
		await Promise.all(
			autosaves
				.slice(MAX_AUTOSAVE_SNAPSHOTS)
				.map((item) => fs.unlink(this.snapshotFileFor(projectId, item.id)).catch(() => undefined)),
		);
	}
}

function sanitizeFileName(value: string): string {
	return Array.from(value, (character) =>
		character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? "-" : character,
	)
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 96);
}

async function hashFile(filePath: string): Promise<string> {
	const digest = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
	return digest.digest("hex");
}

function artworkMimeType(filePath: string): "image/heic" | "image/jpeg" | "image/png" {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === ".png") return "image/png";
	if (extension === ".heic" || extension === ".heif") return "image/heic";
	return "image/jpeg";
}
