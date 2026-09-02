import { memo, useEffect, useRef, useState } from "react";
import {
	MAX_WEBCAM_PREVIEW_SIZE,
	MIN_WEBCAM_PREVIEW_SIZE,
	type WebcamPreviewAppearance,
} from "@/lib/userPreferences";
import styles from "./LaunchWindow.module.css";

export interface HudWebcamOffset {
	x: number;
	y: number;
}

// Let the card sit flush with the usable display edge. The native HUD window
// expands to the display work area while this view is enabled, so zero here is
// the actual corner of that surface rather than the edge of the compact HUD.
const VIEWPORT_MARGIN = 0;

function clampPosition(position: HudWebcamOffset, width: number, height: number): HudWebcamOffset {
	return {
		x: Math.min(
			Math.max(VIEWPORT_MARGIN, position.x),
			Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
		),
		y: Math.min(
			Math.max(VIEWPORT_MARGIN, position.y),
			Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
		),
	};
}

export const HudWebcamSelfView = memo(function HudWebcamSelfView({
	stream,
	recording,
	previewLabel,
	searchingLabel,
	position,
	onPositionChange,
	onSizeChange,
	appearance,
}: {
	stream: MediaStream | null;
	recording: boolean;
	previewLabel: string;
	searchingLabel: string;
	position: HudWebcamOffset | null;
	onPositionChange: (position: HudWebcamOffset | null) => void;
	onSizeChange: (size: number) => void;
	appearance: WebcamPreviewAppearance;
}) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const selfViewRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		width: number;
		height: number;
		baseLeft: number;
		baseTop: number;
	} | null>(null);
	const resizeRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originSize: number;
	} | null>(null);
	const [dragging, setDragging] = useState(false);
	const [resizing, setResizing] = useState(false);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.srcObject = stream;
		return () => {
			video.srcObject = null;
		};
	}, [stream]);

	// Re-run after shape or size changes even though those values affect the
	// measured DOM box rather than being read directly inside this effect.
	// biome-ignore lint/correctness/useExhaustiveDependencies: preview dimensions must trigger a viewport re-clamp
	useEffect(() => {
		if (!position) return;
		const keepInsideViewport = () => {
			const rect = selfViewRef.current?.getBoundingClientRect();
			if (!rect) return;
			const clamped = clampPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);
			if (clamped.x !== rect.left || clamped.y !== rect.top) {
				onPositionChange({
					x: position.x + clamped.x - rect.left,
					y: position.y + clamped.y - rect.top,
				});
			}
		};
		keepInsideViewport();
		window.addEventListener("resize", keepInsideViewport);
		return () => window.removeEventListener("resize", keepInsideViewport);
	}, [appearance.shape, appearance.size, onPositionChange, position]);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const clamped = clampPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);
		const origin = {
			x: (position?.x ?? 0) + clamped.x - rect.left,
			y: (position?.y ?? 0) + clamped.y - rect.top,
		};
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: origin.x,
			originY: origin.y,
			width: rect.width,
			height: rect.height,
			baseLeft: clamped.x,
			baseTop: clamped.y,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
		onPositionChange(origin);
		setDragging(true);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		event.preventDefault();
		const clamped = clampPosition(
			{
				x: drag.baseLeft + event.clientX - drag.startX,
				y: drag.baseTop + event.clientY - drag.startY,
			},
			drag.width,
			drag.height,
		);
		onPositionChange({
			x: drag.originX + clamped.x - drag.baseLeft,
			y: drag.originY + clamped.y - drag.baseTop,
		});
	};

	const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		dragRef.current = null;
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		setDragging(false);
	};

	const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		resizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originSize: appearance.size,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
		setResizing(true);
	};

	const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		const resize = resizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		const aspect = appearance.shape === "circle" || appearance.shape === "square" ? 1 : 16 / 9;
		const delta = Math.max(event.clientX - resize.startX, (event.clientY - resize.startY) * aspect);
		const viewportMaximum = Math.min(window.innerWidth, window.innerHeight * aspect);
		const size = Math.round(
			Math.min(
				MAX_WEBCAM_PREVIEW_SIZE,
				viewportMaximum,
				Math.max(MIN_WEBCAM_PREVIEW_SIZE, resize.originSize + delta),
			),
		);
		onSizeChange(size);
	};

	const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
		const resize = resizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		resizeRef.current = null;
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		setResizing(false);
	};

	return (
		<div
			ref={selfViewRef}
			data-testid="hud-webcam-self-view"
			data-recording={recording ? "true" : "false"}
			data-dragging={dragging ? "true" : "false"}
			data-resizing={resizing ? "true" : "false"}
			data-hud-interactive="true"
			data-shape={appearance.shape}
			className={styles.hudWebcamSelfView}
			style={{
				width: `${appearance.size}px`,
				aspectRatio:
					appearance.shape === "circle" || appearance.shape === "square" ? "1 / 1" : "16 / 9",
				...(position ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` } : null),
			}}
			aria-label={previewLabel}
			title={`${previewLabel} — drag to move`}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerEnd}
			onPointerCancel={handlePointerEnd}
			onDoubleClick={() => onPositionChange(null)}
		>
			{stream ? (
				// No <track>: this is a live, muted self-view with nothing to caption.
				<video
					ref={videoRef}
					data-testid="hud-webcam-self-view-video"
					className={styles.hudWebcamSelfViewVideo}
					style={{ filter: `brightness(${appearance.brightness}%)` }}
					autoPlay
					muted
					playsInline
				/>
			) : (
				<span className={styles.hudWebcamSelfViewFallback}>{searchingLabel}</span>
			)}
			{recording ? <span className={styles.hudWebcamRecordingDot} aria-hidden="true" /> : null}
			<span className={styles.hudWebcamDragAffordance} aria-hidden="true">
				•••
			</span>
			<button
				type="button"
				className={styles.hudWebcamResizeHandle}
				aria-label="Resize camera preview"
				title="Drag to resize camera preview"
				onPointerDown={handleResizeStart}
				onPointerMove={handleResizeMove}
				onPointerUp={handleResizeEnd}
				onPointerCancel={handleResizeEnd}
			/>
		</div>
	);
});
