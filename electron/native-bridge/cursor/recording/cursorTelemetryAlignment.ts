import type { CursorRecordingSample } from "../../../../src/native/contracts";

/**
 * Rebase cursor telemetry from helper-start time to the screen capture's true
 * first frame. The cursor helper intentionally warms up before ScreenCaptureKit
 * does, so simply clamping negative timestamps to zero piles every warm-up
 * position onto t=0 and makes the synthetic pointer jump/trail at playback start.
 *
 * Keep one position-only anchor at t=0 (the last known cursor position before
 * capture) and discard the rest of the warm-up samples. A real sample exactly at
 * capture start wins and keeps its interaction metadata.
 */
export function alignCursorSamplesToCaptureStart(
	samples: CursorRecordingSample[],
	offsetMs: number,
): CursorRecordingSample[] {
	if (!Number.isFinite(offsetMs) || offsetMs <= 0 || samples.length === 0) {
		return [...samples].sort((a, b) => a.timeMs - b.timeMs);
	}

	const ordered = [...samples].sort((a, b) => a.timeMs - b.timeMs);
	let exact: CursorRecordingSample | undefined;
	let prior: CursorRecordingSample | undefined;
	for (const point of ordered) {
		if (point.timeMs < offsetMs) prior = point;
		else if (point.timeMs === offsetMs) exact = point;
		else break;
	}
	const aligned = ordered
		.filter((sample) => sample.timeMs >= offsetMs)
		.map((sample) => ({ ...sample, timeMs: sample.timeMs - offsetMs }));

	if (!exact && prior) {
		aligned.unshift({
			...prior,
			timeMs: 0,
			interactionType: "move",
		});
	}

	return aligned;
}
