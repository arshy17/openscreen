import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { MediaProbe } from "../../src/lib/ai-edition/schema";

export type ProjectMediaSourceKind = "files" | "photos";
export type ProjectMediaKind = "video" | "artwork";
export type ProjectMediaImportPhase = "checking" | "copying" | "probing" | "proxy" | "complete";

export interface ProjectMediaImportProgress {
	jobId: string;
	itemIndex: number;
	itemCount: number;
	fileName: string;
	phase: ProjectMediaImportPhase;
	percent: number;
}

export interface ManagedImportFile {
	sourcePath: string;
	managedPath: string;
	sha256: string;
	sizeBytes: number;
	probe: MediaProbe;
	mediaKind: ProjectMediaKind;
	proxyPath?: string;
	proxyStatus: "not-needed" | "ready" | "failed" | "cancelled";
	proxyError?: string;
}

export interface ImportRuntimeOptions {
	jobId: string;
	projectId: string;
	projectsRoot: string;
	source: ProjectMediaSourceKind;
	paths: string[];
	mediaKinds: ProjectMediaKind[];
	signal?: AbortSignal;
	onProgress?: (progress: ProjectMediaImportProgress) => void;
}

const VIDEO_EXTENSIONS = new Set([
	".mp4",
	".mov",
	".m4v",
	".webm",
	".mkv",
	".avi",
	".wmv",
	".flv",
	".ts",
]);
const ARTWORK_EXTENSIONS = new Set([".heic", ".heif", ".jpg", ".jpeg", ".png"]);

function executableName(base: string): string {
	return process.platform === "win32" ? `${base}.exe` : base;
}

function isExecutable(candidate: string): Promise<boolean> {
	return fs
		.access(candidate, fsConstants.X_OK)
		.then(() => true)
		.catch(() => false);
}

export async function resolveMediaTool(name: "ffmpeg" | "ffprobe"): Promise<string | null> {
	const exe = executableName(name);
	const tag = `${process.platform}-${process.arch}`;
	const candidates = [
		process.env[`OPENSCREEN_${name.toUpperCase()}_PATH`]?.trim(),
		path.join(process.resourcesPath || "", "electron", "native", "bin", tag, exe),
		path.join(process.cwd(), "electron", "native", "bin", tag, exe),
		path.join(
			process.cwd(),
			"crates",
			"thirdparty",
			"ffmpeg-n8.1.2-macos64-lgpl-shared",
			"bin",
			exe,
		),
		name,
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		if (candidate === name) return candidate;
		if (await isExecutable(candidate)) return candidate;
	}
	return null;
}

export function parseRate(value: unknown): number {
	if (typeof value !== "string" || !value.trim() || value === "0/0") return 0;
	const [numerator, denominator = "1"] = value.split("/");
	const result = Number(numerator) / Number(denominator);
	return Number.isFinite(result) && result >= 0 ? result : 0;
}

type FfprobeStream = {
	codec_type?: string;
	codec_name?: string;
	codec_tag_string?: string;
	width?: number;
	height?: number;
	r_frame_rate?: string;
	avg_frame_rate?: string;
	color_primaries?: string;
	color_transfer?: string;
	color_space?: string;
	tags?: Record<string, string>;
	side_data_list?: Array<Record<string, unknown>>;
};

export function parseFfprobeResult(raw: unknown, fileSizeBytes: number): MediaProbe {
	const data = (raw && typeof raw === "object" ? raw : {}) as {
		format?: { format_name?: string; duration?: string | number };
		streams?: FfprobeStream[];
	};
	const streams = Array.isArray(data.streams) ? data.streams : [];
	const video = streams.find((stream) => stream.codec_type === "video");
	const audio = streams.filter((stream) => stream.codec_type === "audio");
	const frameRate = parseRate(video?.r_frame_rate);
	const averageFrameRate = parseRate(video?.avg_frame_rate);
	const sideData = video?.side_data_list ?? [];
	const rotationValue =
		video?.tags?.rotate ??
		String(sideData.find((entry) => typeof entry.rotation === "number")?.rotation ?? 0);
	const rotationDegrees = Number.isFinite(Number(rotationValue))
		? Math.round(Number(rotationValue))
		: 0;
	const transfer = video?.color_transfer ?? null;
	const primaries = video?.color_primaries ?? null;
	const dolbyVision =
		["dvh1", "dvhe"].includes((video?.codec_tag_string ?? "").toLowerCase()) ||
		sideData.some((entry) =>
			String(entry.side_data_type ?? "")
				.toLowerCase()
				.includes("dovi"),
		);
	const hdr =
		dolbyVision ||
		transfer === "smpte2084" ||
		transfer === "arib-std-b67" ||
		primaries === "bt2020";
	return {
		container: data.format?.format_name ?? "unknown",
		videoCodec: video?.codec_name ?? "unknown",
		audioCodecs: audio.map((stream) => stream.codec_name ?? "unknown"),
		width: Math.max(0, Math.round(video?.width ?? 0)),
		height: Math.max(0, Math.round(video?.height ?? 0)),
		frameRate,
		averageFrameRate,
		variableFrameRate:
			frameRate > 0 && averageFrameRate > 0 && Math.abs(frameRate - averageFrameRate) > 0.05,
		durationSec: Math.max(0, Number(data.format?.duration ?? 0) || 0),
		rotationDegrees,
		colorPrimaries: primaries,
		colorTransfer: transfer,
		colorSpace: video?.color_space ?? null,
		dynamicRange: dolbyVision ? "dolby-vision" : hdr ? "hdr" : video ? "sdr" : "unknown",
		audioTrackCount: audio.length,
		fileSizeBytes,
	};
}

export function needsEditingProxy(probe: MediaProbe): boolean {
	const codec = probe.videoCodec.toLowerCase();
	return (
		["hevc", "h265", "prores"].some((value) => codec.includes(value)) ||
		probe.width > 1920 ||
		probe.height > 1080 ||
		probe.frameRate > 30.5 ||
		probe.averageFrameRate > 30.5 ||
		probe.variableFrameRate ||
		probe.dynamicRange === "hdr" ||
		probe.dynamicRange === "dolby-vision"
	);
}

function runProcess(
	command: string,
	args: string[],
	signal?: AbortSignal,
	onStderr?: (text: string) => void,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new DOMException("Import cancelled", "AbortError"));
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const cancel = () => child.kill("SIGTERM");
		signal?.addEventListener("abort", cancel, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			stderr = `${stderr}${text}`.slice(-64 * 1024);
			onStderr?.(text);
		});
		child.once("error", reject);
		child.once("close", (code) => {
			signal?.removeEventListener("abort", cancel);
			if (signal?.aborted) return reject(new DOMException("Import cancelled", "AbortError"));
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr.trim()}`));
		});
	});
}

export async function probeMediaFile(filePath: string, signal?: AbortSignal): Promise<MediaProbe> {
	const stats = await fs.stat(filePath);
	const ffprobe = await resolveMediaTool("ffprobe");
	if (!ffprobe) throw new Error("The bundled ffprobe media inspector is unavailable.");
	const { stdout } = await runProcess(
		ffprobe,
		["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
		signal,
	);
	return parseFfprobeResult(JSON.parse(stdout), stats.size);
}

export async function hashFile(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

function safeName(value: string): string {
	return Array.from(value)
		.map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
		.join("")
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

async function assertDiskSpace(directory: string, requiredBytes: number): Promise<void> {
	if (typeof fs.statfs !== "function") return;
	const stats = await fs.statfs(directory);
	const available = Number(stats.bavail) * Number(stats.bsize);
	if (available < requiredBytes) {
		throw new Error(
			`Not enough free space. This import needs about ${Math.ceil(requiredBytes / 1_048_576)} MB, ` +
				`but only ${Math.floor(available / 1_048_576)} MB is available.`,
		);
	}
}

function parseFfmpegProgress(text: string, durationSec: number): number | null {
	const match = /out_time_ms=(\d+)/.exec(text);
	if (!match || durationSec <= 0) return null;
	return Math.min(99, (Number(match[1]) / 1_000_000 / durationSec) * 100);
}

async function makeEditingProxy(
	inputPath: string,
	outputPath: string,
	probe: MediaProbe,
	signal: AbortSignal | undefined,
	onProgress: (percent: number) => void,
): Promise<void> {
	const ffmpeg = await resolveMediaTool("ffmpeg");
	if (!ffmpeg) throw new Error("The bundled ffmpeg proxy generator is unavailable.");
	const scale = "scale='min(1920,iw)':-2:force_original_aspect_ratio=decrease";
	const isHdr = probe.dynamicRange === "hdr" || probe.dynamicRange === "dolby-vision";
	const filters = (toneMap?: string) =>
		[
			...(toneMap ? [toneMap] : []),
			scale,
			"fps=30",
			"format=yuv420p",
			"setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
		].join(",");
	const args = (videoFilters: string) => [
		"-hide_banner",
		"-y",
		"-i",
		inputPath,
		"-map",
		"0:v:0",
		"-map",
		"0:a:0?",
		"-vf",
		videoFilters,
		"-c:v",
		process.platform === "darwin" ? "h264_videotoolbox" : "libx264",
		"-b:v",
		"8M",
		"-maxrate",
		"12M",
		"-bufsize",
		"16M",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-colorspace",
		"bt709",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		"-progress",
		"pipe:2",
		outputPath,
	];
	let progressBuffer = "";
	const encode = (videoFilters: string) =>
		runProcess(ffmpeg, args(videoFilters), signal, (text) => {
			progressBuffer = `${progressBuffer}${text}`.slice(-4096);
			const percent = parseFfmpegProgress(progressBuffer, probe.durationSec);
			if (percent !== null) onProgress(percent);
		});
	if (!isHdr) {
		await encode(filters());
		return;
	}
	try {
		// CISystemToneMap consumes the HDR attachments carried by the iPhone frame
		// and renders to standard display headroom before the explicit Rec.709 tag.
		await encode(filters("coreimage=filter=CISystemToneMap@inputDisplayHeadroom=1.0"));
	} catch (error) {
		if (signal?.aborted) throw error;
		// Older macOS 13 Core Image installations may not expose CISystemToneMap.
		// Keep import functional with a conservative highlight roll-off instead of
		// silently using the HDR original as an expensive editing surface.
		progressBuffer = "";
		await encode(filters("coreimage=filter=CIHighlightShadowAdjust@inputHighlightAmount=0.65"));
	}
}

async function makeArtworkProxy(
	inputPath: string,
	outputPath: string,
	signal?: AbortSignal,
): Promise<void> {
	const ffmpeg = await resolveMediaTool("ffmpeg");
	if (!ffmpeg) throw new Error("The bundled ffmpeg image converter is unavailable.");
	await runProcess(
		ffmpeg,
		["-hide_banner", "-y", "-i", inputPath, "-frames:v", "1", "-pix_fmt", "rgba", outputPath],
		signal,
	);
}

function detectKind(filePath: string): ProjectMediaKind | null {
	const ext = path.extname(filePath).toLowerCase();
	if (VIDEO_EXTENSIONS.has(ext)) return "video";
	if (ARTWORK_EXTENSIONS.has(ext)) return "artwork";
	return null;
}

export async function importManagedProjectMedia(
	options: ImportRuntimeOptions,
): Promise<ManagedImportFile[]> {
	const importsDir = path.join(options.projectsRoot, options.projectId, "Media", "Imports");
	const proxiesDir = path.join(options.projectsRoot, options.projectId, "Media", "Proxies");
	await fs.mkdir(importsDir, { recursive: true });
	await fs.mkdir(proxiesDir, { recursive: true });
	const output: ManagedImportFile[] = [];
	for (let index = 0; index < options.paths.length; index += 1) {
		const sourcePath = path.resolve(options.paths[index]);
		const fileName = path.basename(sourcePath);
		const emit = (phase: ProjectMediaImportPhase, percent: number) =>
			options.onProgress?.({
				jobId: options.jobId,
				itemIndex: index,
				itemCount: options.paths.length,
				fileName,
				phase,
				percent,
			});
		emit("checking", 0);
		if (options.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
		const kind = detectKind(sourcePath);
		if (!kind || !options.mediaKinds.includes(kind)) {
			throw new Error(`Unsupported ${path.extname(fileName) || "file"} selection: ${fileName}`);
		}
		const stats = await fs.stat(sourcePath);
		if (!stats.isFile()) throw new Error(`Selected item is not a file: ${fileName}`);
		await assertDiskSpace(importsDir, Math.max(stats.size * 2 + 256 * 1024 * 1024, stats.size));
		const sourceHash = await hashFile(sourcePath);
		const ext = path.extname(fileName).toLowerCase();
		const base = safeName(path.basename(fileName, ext)) || "import";
		const managedPath = path.join(importsDir, `${base}-${sourceHash.slice(0, 12)}${ext}`);
		emit("copying", 10);
		try {
			await fs.access(managedPath);
		} catch {
			const tempPath = `${managedPath}.${process.pid}.tmp`;
			await fs.copyFile(sourcePath, tempPath);
			if ((await hashFile(tempPath)) !== sourceHash) {
				await fs.rm(tempPath, { force: true });
				throw new Error(`Checksum mismatch while copying ${fileName}.`);
			}
			await fs.rename(tempPath, managedPath);
		}
		emit("probing", 40);
		const probe = await probeMediaFile(managedPath, options.signal);
		let proxyPath: string | undefined;
		let proxyStatus: ManagedImportFile["proxyStatus"] = "not-needed";
		let proxyError: string | undefined;
		if (kind === "video" && needsEditingProxy(probe)) {
			proxyPath = path.join(proxiesDir, `${base}-${sourceHash.slice(0, 12)}-edit.mp4`);
			try {
				emit("proxy", 45);
				await makeEditingProxy(managedPath, proxyPath, probe, options.signal, (percent) =>
					emit("proxy", 45 + percent * 0.54),
				);
				proxyStatus = "ready";
			} catch (error) {
				await fs.rm(proxyPath, { force: true });
				if (options.signal?.aborted) {
					proxyStatus = "cancelled";
					throw error;
				}
				proxyStatus = "failed";
				proxyError = error instanceof Error ? error.message : String(error);
				proxyPath = undefined;
			}
		} else if (kind === "artwork" && [".heic", ".heif"].includes(ext)) {
			proxyPath = path.join(proxiesDir, `${base}-${sourceHash.slice(0, 12)}-artwork.png`);
			try {
				emit("proxy", 60);
				await makeArtworkProxy(managedPath, proxyPath, options.signal);
				proxyStatus = "ready";
			} catch (error) {
				await fs.rm(proxyPath, { force: true });
				proxyStatus = options.signal?.aborted ? "cancelled" : "failed";
				proxyError = error instanceof Error ? error.message : String(error);
				proxyPath = undefined;
				if (options.signal?.aborted) throw error;
			}
		}
		emit("complete", 100);
		output.push({
			sourcePath,
			managedPath,
			sha256: sourceHash,
			sizeBytes: stats.size,
			probe,
			mediaKind: kind,
			proxyPath,
			proxyStatus,
			proxyError,
		});
	}
	return output;
}
