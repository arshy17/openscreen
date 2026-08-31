/**
 * Pure helpers for translating a DOM `getBoundingClientRect()` into device-pixel
 * coordinates the native D3D11 compositor addon expects. Kept side-effect free
 * so it's trivially unit-testable and shareable between the React hook and any
 * non-React caller (e.g. a future render-loop chip in Pixi).
 */
import type { CompositorViewRect } from "./contracts";

/**
 * The compositor frame crosses Electron IPC as raw RGBA. A Retina-sized 1920x1080
 * preview is about 8 MiB per frame before the canvas paints it; sending that at
 * 60 fps competes with playback and pointer updates for no visible benefit when
 * the CSS preview is half that size. Export is a separate native render target
 * and is not affected by this ceiling.
 */
export const PREVIEW_MAX_WIDTH = 1600;
export const PREVIEW_MAX_HEIGHT = 900;

/**
 * Convert a CSS-pixel rect (as returned by `Element.getBoundingClientRect()`)
 * to the device-pixel rect the compositor addon expects. All four values are
 * rounded via `Math.round` because the addon returns either truncated or
 * off-by-one windows when handed non-integer values.
 */
export function computeDeviceRect(
	domRect: { left: number; top: number; width: number; height: number },
	devicePixelRatio: number,
): CompositorViewRect {
	const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
	return {
		x: Math.round(domRect.left * ratio),
		y: Math.round(domRect.top * ratio),
		width: Math.round(domRect.width * ratio),
		height: Math.round(domRect.height * ratio),
	};
}

/**
 * Size the interactive preview at CSS-pixel density, capped to 1600x900 while
 * preserving its aspect ratio. This keeps the raw-frame IPC path light enough
 * for a steady 60 fps on HiDPI displays without changing export resolution.
 */
export function computePreviewRect(
	domRect: { left: number; top: number; width: number; height: number },
	devicePixelRatio: number,
): CompositorViewRect {
	const ratio =
		Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(1, devicePixelRatio) : 1;
	const cssRect = computeDeviceRect(domRect, ratio);
	if (cssRect.width <= 0 || cssRect.height <= 0) {
		return cssRect;
	}
	const fit = Math.min(1, PREVIEW_MAX_WIDTH / cssRect.width, PREVIEW_MAX_HEIGHT / cssRect.height);
	return {
		x: cssRect.x,
		y: cssRect.y,
		width: Math.max(1, Math.round(cssRect.width * fit)),
		height: Math.max(1, Math.round(cssRect.height * fit)),
	};
}

/**
 * Cheap structural equality check for two device rects. Used by the React
 * hook to skip re-sending `setRect` when nothing has changed (which would
 * otherwise churn the native window needlessly).
 */
export function rectsEqual(a: CompositorViewRect, b: CompositorViewRect): boolean {
	return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
