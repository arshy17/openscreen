import type { AxcutClip } from "../schema";

export type MediaInsertionSide = "before" | "after";

/**
 * Choose the clip boundary represented by the two media buttons beside the preview.
 * A selected clip wins; otherwise the button follows the clip under the playhead.
 */
export function mediaInsertionIndex(
	clips: readonly AxcutClip[],
	playheadSec: number,
	side: MediaInsertionSide,
	selectedClipId?: string | null,
): number {
	if (clips.length === 0) return 0;

	let anchor = selectedClipId ? clips.findIndex((clip) => clip.id === selectedClipId) : -1;
	if (anchor < 0) {
		anchor = clips.findIndex(
			(clip, index) =>
				playheadSec >= clip.timelineStartSec &&
				(playheadSec < clip.timelineEndSec ||
					(index === clips.length - 1 && playheadSec === clip.timelineEndSec)),
		);
	}
	if (anchor < 0) anchor = playheadSec < clips[0].timelineStartSec ? 0 : clips.length - 1;

	return side === "before" ? anchor : anchor + 1;
}
