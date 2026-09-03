import { toFileUrl } from "@/components/video-editor/projectPersistence";
import { getArtworkPreset } from "./artwork";
import type { ArtworkAsset, ArtworkDesign, ArtworkLayer } from "./schema";

function imageUrl(filePath: string): string {
	return /^(blob|data|https?):/.test(filePath) ? filePath : toFileUrl(filePath);
}

function loadImage(filePath: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.decoding = "async";
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Could not decode ${filePath.split(/[\\/]/).pop()}.`));
		image.src = imageUrl(filePath);
	});
}

function drawCoverImage(
	context: CanvasRenderingContext2D,
	image: CanvasImageSource & { width: number; height: number },
	layer: Extract<ArtworkLayer, { type: "image" }>,
): void {
	const sourceRatio = image.width / image.height;
	const targetRatio = layer.width / layer.height;
	let sourceWidth = image.width;
	let sourceHeight = image.height;
	if (layer.fit === "cover") {
		if (sourceRatio > targetRatio) sourceWidth = image.height * targetRatio;
		else sourceHeight = image.width / targetRatio;
	}
	const sourceX = Math.max(0, (image.width - sourceWidth) * layer.cropX);
	const sourceY = Math.max(0, (image.height - sourceHeight) * layer.cropY);
	context.filter = layer.blur > 0 ? `blur(${layer.blur}px)` : "none";
	if (layer.fit === "contain") {
		const scale = Math.min(layer.width / image.width, layer.height / image.height);
		const width = image.width * scale;
		const height = image.height * scale;
		context.drawImage(
			image,
			layer.x + (layer.width - width) / 2,
			layer.y + (layer.height - height) / 2,
			width,
			height,
		);
	} else {
		context.drawImage(
			image,
			sourceX,
			sourceY,
			sourceWidth,
			sourceHeight,
			layer.x,
			layer.y,
			layer.width,
			layer.height,
		);
	}
	context.filter = "none";
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split(/\n/)) {
		const words = paragraph.split(/\s+/).filter(Boolean);
		let line = "";
		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (line && context.measureText(candidate).width > width) {
				lines.push(line);
				line = word;
			} else line = candidate;
		}
		lines.push(line);
	}
	return lines;
}

function roundedRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	const r = Math.min(radius, width / 2, height / 2);
	context.beginPath();
	context.moveTo(x + r, y);
	context.arcTo(x + width, y, x + width, y + height, r);
	context.arcTo(x + width, y + height, x, y + height, r);
	context.arcTo(x, y + height, x, y, r);
	context.arcTo(x, y, x + width, y, r);
	context.closePath();
}

function drawIcon(
	context: CanvasRenderingContext2D,
	layer: Extract<ArtworkLayer, { type: "icon" }>,
): void {
	if (layer.background) {
		context.fillStyle = layer.background;
		context.beginPath();
		context.ellipse(
			layer.x + layer.width / 2,
			layer.y + layer.height / 2,
			layer.width / 2,
			layer.height / 2,
			0,
			0,
			Math.PI * 2,
		);
		context.fill();
	}
	context.strokeStyle = layer.color;
	context.fillStyle = layer.color;
	context.lineWidth = Math.max(3, Math.min(layer.width, layer.height) * 0.08);
	context.lineCap = "round";
	context.lineJoin = "round";
	const cx = layer.x + layer.width / 2;
	const cy = layer.y + layer.height / 2;
	if (layer.icon === "play") {
		context.beginPath();
		context.moveTo(layer.x + layer.width * 0.32, layer.y + layer.height * 0.2);
		context.lineTo(layer.x + layer.width * 0.78, cy);
		context.lineTo(layer.x + layer.width * 0.32, layer.y + layer.height * 0.8);
		context.closePath();
		context.fill();
	} else if (layer.icon === "check") {
		context.beginPath();
		context.moveTo(layer.x + layer.width * 0.18, cy);
		context.lineTo(layer.x + layer.width * 0.42, layer.y + layer.height * 0.73);
		context.lineTo(layer.x + layer.width * 0.84, layer.y + layer.height * 0.24);
		context.stroke();
	} else if (layer.icon === "arrow") {
		context.beginPath();
		context.moveTo(layer.x + layer.width * 0.15, cy);
		context.lineTo(layer.x + layer.width * 0.82, cy);
		context.moveTo(layer.x + layer.width * 0.6, layer.y + layer.height * 0.27);
		context.lineTo(layer.x + layer.width * 0.82, cy);
		context.lineTo(layer.x + layer.width * 0.6, layer.y + layer.height * 0.73);
		context.stroke();
	} else {
		const points = 5;
		context.beginPath();
		for (let i = 0; i < points * 2; i += 1) {
			const angle = -Math.PI / 2 + (i * Math.PI) / points;
			const radius = (i % 2 === 0 ? 0.46 : 0.2) * Math.min(layer.width, layer.height);
			const x = cx + Math.cos(angle) * radius;
			const y = cy + Math.sin(angle) * radius;
			if (i === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		}
		context.closePath();
		context.fill();
	}
}

async function drawLayer(
	context: CanvasRenderingContext2D,
	layer: ArtworkLayer,
	assets: ReadonlyMap<string, ArtworkAsset>,
): Promise<void> {
	if (!layer.visible) return;
	context.save();
	context.globalAlpha = layer.opacity;
	context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
	context.rotate((layer.rotation * Math.PI) / 180);
	context.translate(-(layer.x + layer.width / 2), -(layer.y + layer.height / 2));
	if (layer.type === "image") {
		const asset = assets.get(layer.assetId);
		if (asset) drawCoverImage(context, await loadImage(asset.path), layer);
	} else if (layer.type === "shape") {
		context.fillStyle = layer.fill;
		context.strokeStyle = layer.stroke;
		context.lineWidth = layer.strokeWidth;
		if (layer.shape === "ellipse") {
			context.beginPath();
			context.ellipse(
				layer.x + layer.width / 2,
				layer.y + layer.height / 2,
				layer.width / 2,
				layer.height / 2,
				0,
				0,
				Math.PI * 2,
			);
		} else if (layer.shape === "line") {
			context.beginPath();
			context.moveTo(layer.x, layer.y + layer.height / 2);
			context.lineTo(layer.x + layer.width, layer.y + layer.height / 2);
		} else {
			roundedRect(
				context,
				layer.x,
				layer.y,
				layer.width,
				layer.height,
				layer.shape === "rounded-rectangle" ? layer.cornerRadius : 0,
			);
		}
		if (layer.shape !== "line") context.fill();
		if (layer.strokeWidth > 0 || layer.shape === "line") context.stroke();
	} else if (layer.type === "icon") drawIcon(context, layer);
	else {
		context.font = `${layer.fontWeight} ${layer.fontSize}px ${JSON.stringify(layer.fontFamily)}, sans-serif`;
		context.textAlign = layer.align;
		context.textBaseline = "top";
		context.fillStyle = layer.color;
		context.strokeStyle = layer.strokeColor;
		context.lineWidth = layer.strokeWidth * 2;
		context.shadowColor = layer.shadowColor;
		context.shadowBlur = layer.shadowBlur;
		const x =
			layer.align === "center"
				? layer.x + layer.width / 2
				: layer.align === "right"
					? layer.x + layer.width
					: layer.x;
		const lines = wrapText(context, layer.text, layer.width);
		const lineHeight = layer.fontSize * 1.12;
		for (let index = 0; index < lines.length; index += 1) {
			const y = layer.y + index * lineHeight;
			if (y + lineHeight > layer.y + layer.height + 0.5) break;
			if (layer.strokeWidth > 0) context.strokeText(lines[index], x, y, layer.width);
			context.fillText(lines[index], x, y, layer.width);
		}
	}
	context.restore();
}

export async function renderArtworkToBlob(
	design: ArtworkDesign,
	assets: ArtworkAsset[],
	format: "png" | "jpeg",
	quality = 0.92,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = design.width;
	canvas.height = design.height;
	const context = canvas.getContext("2d", { alpha: format === "png" });
	if (!context) throw new Error("Canvas rendering is unavailable.");
	if (design.background.kind === "gradient") {
		const colors = design.background.value.match(/#[0-9a-f]{6,8}/gi) ?? ["#111827", "#2563eb"];
		const gradient = context.createLinearGradient(0, 0, design.width, design.height);
		colors.forEach((color, index) =>
			gradient.addColorStop(index / Math.max(1, colors.length - 1), color),
		);
		context.fillStyle = gradient;
	} else context.fillStyle = design.background.value;
	context.fillRect(0, 0, design.width, design.height);
	const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
	for (const layer of [...design.layers].sort((left, right) => left.zIndex - right.zIndex)) {
		await drawLayer(context, layer, assetMap);
	}
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("Artwork encoding failed."))),
			format === "jpeg" ? "image/jpeg" : "image/png",
			quality,
		),
	);
}

export function resizeArtworkDesign(design: ArtworkDesign, presetId: string): ArtworkDesign {
	const preset = getArtworkPreset(presetId);
	const scaleX = preset.width / design.width;
	const scaleY = preset.height / design.height;
	const uniform = Math.min(scaleX, scaleY);
	return {
		...design,
		id: `${design.id}-${preset.id}`,
		name: preset.name,
		presetId: preset.id,
		width: preset.width,
		height: preset.height,
		safeAreaPreset: preset.id,
		layers: design.layers.map((layer) => ({
			...layer,
			x: layer.x * scaleX,
			y: layer.y * scaleY,
			width: layer.width * scaleX,
			height: layer.height * scaleY,
			...(layer.type === "text" ? { fontSize: layer.fontSize * uniform } : {}),
		})),
	};
}
