import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArtworkFrameCandidate } from "../../src/native/contracts";
import { resolveMediaTool } from "../media/projectMediaImport";
import type { DocumentService } from "./document-service";

type VisionRank = Omit<ArtworkFrameCandidate, "id" | "assetId" | "timeSec" | "width" | "height"> & {
	path: string;
};

function run(command: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
		child.stderr.on("data", (chunk: Buffer) => (stderr = `${stderr}${chunk}`.slice(-32_000)));
		child.once("error", reject);
		child.once("close", (code) =>
			code === 0
				? resolve(stdout)
				: reject(new Error(`${path.basename(command)} failed: ${stderr.trim()}`)),
		);
	});
}

async function resolveVisionHelper(): Promise<string> {
	const tag = `${process.platform}-${process.arch}`;
	const name = "openscreen-artwork-vision-helper";
	const candidates = [
		path.join(process.resourcesPath || "", "electron", "native", "bin", tag, name),
		path.join(process.cwd(), "electron", "native", "bin", tag, name),
		path.join(process.cwd(), "electron", "native", "screencapturekit", "build", name),
	];
	for (const candidate of candidates) {
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// Try the next signed/dev helper location.
		}
	}
	throw new Error(
		"The local Apple Vision artwork helper is unavailable. Rebuild the macOS helpers.",
	);
}

function evenlySpacedTimes(durationSec: number, count: number): number[] {
	const safeCount = Math.max(3, Math.min(24, count));
	if (durationSec <= 0) return [0];
	return Array.from({ length: safeCount }, (_, index) =>
		Math.min(Math.max(0, durationSec - 0.05), ((index + 0.5) / safeCount) * durationSec),
	);
}

export async function generateArtworkFrameCandidates(
	documents: DocumentService,
	projectId: string,
	assetId: string,
	count = 8,
): Promise<ArtworkFrameCandidate[]> {
	if (process.platform !== "darwin") {
		throw new Error("Local Vision frame ranking is currently available on macOS only.");
	}
	const document = await documents.getProject(projectId);
	const asset = document.assets.find((item) => item.id === assetId);
	if (!asset) throw new Error("The selected video is no longer part of this project.");
	const source = asset.managedImport?.managedOriginalPath ?? asset.originalPath;
	const durationSec = asset.managedImport?.probe.durationSec ?? asset.durationSec ?? 0;
	const width = asset.managedImport?.probe.width ?? asset.video?.width ?? 0;
	const height = asset.managedImport?.probe.height ?? asset.video?.height ?? 0;
	const ffmpeg = await resolveMediaTool("ffmpeg");
	if (!ffmpeg) throw new Error("The bundled frame extractor is unavailable.");
	const directory = path.join(
		documents.getManagedProjectDirectory(projectId),
		"Media",
		"Artwork",
		"Frames",
		assetId,
	);
	await fs.mkdir(directory, { recursive: true });
	const times = evenlySpacedTimes(durationSec, count);
	const paths: string[] = [];
	for (let index = 0; index < times.length; index += 1) {
		const output = path.join(directory, `frame-${String(index + 1).padStart(2, "0")}.png`);
		await run(ffmpeg, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			"-ss",
			times[index].toFixed(3),
			"-i",
			source,
			"-frames:v",
			"1",
			output,
		]);
		paths.push(output);
	}
	const helper = await resolveVisionHelper();
	const raw = JSON.parse(await run(helper, [JSON.stringify({ imagePaths: paths })])) as {
		success?: boolean;
		images?: VisionRank[];
		error?: string;
	};
	if (!raw.success)
		throw new Error(raw.error ?? "Apple Vision could not rank the candidate frames.");
	const byPath = new Map(paths.map((value, index) => [value, times[index]]));
	return (raw.images ?? []).slice(0, Math.max(1, count)).map((item, index) => ({
		id: `frame-${assetId}-${index}-${Math.round((byPath.get(item.path) ?? 0) * 1000)}`,
		assetId,
		timeSec: byPath.get(item.path) ?? 0,
		path: item.path,
		width,
		height,
		sharpness: item.sharpness,
		exposure: item.exposure,
		faceVisibility: item.faceVisibility,
		textSpace: item.textSpace,
		score: item.score,
	}));
}

export async function captureArtworkFrame(
	documents: DocumentService,
	projectId: string,
	assetId: string,
	timeSec: number,
): Promise<ArtworkFrameCandidate> {
	const document = await documents.getProject(projectId);
	const asset = document.assets.find((item) => item.id === assetId);
	if (!asset) throw new Error("The selected video is no longer part of this project.");
	const source = asset.managedImport?.managedOriginalPath ?? asset.originalPath;
	const ffmpeg = await resolveMediaTool("ffmpeg");
	if (!ffmpeg) throw new Error("The bundled frame extractor is unavailable.");
	const safeTime = Math.max(
		0,
		Math.min(timeSec, Math.max(0, (asset.durationSec ?? timeSec) - 0.01)),
	);
	const directory = path.join(
		documents.getManagedProjectDirectory(projectId),
		"Media",
		"Artwork",
		"Frames",
		assetId,
	);
	await fs.mkdir(directory, { recursive: true });
	const output = path.join(directory, `capture-${Math.round(safeTime * 1000)}.png`);
	await run(ffmpeg, [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-ss",
		safeTime.toFixed(3),
		"-i",
		source,
		"-frames:v",
		"1",
		output,
	]);
	let rank: VisionRank = {
		path: output,
		sharpness: 0,
		exposure: 0,
		faceVisibility: 0,
		textSpace: 1,
		score: 0,
	};
	if (process.platform === "darwin") {
		const raw = JSON.parse(
			await run(await resolveVisionHelper(), [JSON.stringify({ imagePaths: [output] })]),
		) as { images?: VisionRank[] };
		rank = raw.images?.[0] ?? rank;
	}
	return {
		id: `frame-${assetId}-${Math.round(safeTime * 1000)}`,
		assetId,
		timeSec: safeTime,
		path: output,
		width: asset.managedImport?.probe.width ?? asset.video?.width ?? 0,
		height: asset.managedImport?.probe.height ?? asset.video?.height ?? 0,
		sharpness: rank.sharpness,
		exposure: rank.exposure,
		faceVisibility: rank.faceVisibility,
		textSpace: rank.textSpace,
		score: rank.score,
	};
}

export async function createArtworkSubjectCutout(
	documents: DocumentService,
	projectId: string,
	artworkAssetId: string,
): Promise<{ path: string }> {
	if (process.platform !== "darwin") {
		throw new Error("Local subject cutout is currently available on macOS only.");
	}
	const document = await documents.getProject(projectId);
	const asset = document.artworkAssets.find((item) => item.id === artworkAssetId);
	if (!asset) throw new Error("The selected artwork image is no longer part of this project.");
	const directory = path.join(
		documents.getManagedProjectDirectory(projectId),
		"Media",
		"Artwork",
		"Cutouts",
	);
	await fs.mkdir(directory, { recursive: true });
	const output = path.join(directory, `${artworkAssetId}-subject.png`);
	const raw = JSON.parse(
		await run(await resolveVisionHelper(), [
			JSON.stringify({
				operation: "cutout",
				imagePath: asset.path,
				outputPath: output,
			}),
		]),
	) as { success?: boolean; outputPath?: string; error?: string };
	if (!raw.success || !raw.outputPath) {
		throw new Error(raw.error ?? "Apple Vision could not create the subject cutout.");
	}
	return { path: raw.outputPath };
}
