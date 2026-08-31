import { describe, expect, it } from "vitest";
import type { CursorRecordingSample } from "../../../../src/native/contracts";
import { alignCursorSamplesToCaptureStart } from "./cursorTelemetryAlignment";

function sample(
	timeMs: number,
	cx: number,
	interactionType: CursorRecordingSample["interactionType"] = "move",
): CursorRecordingSample {
	return { timeMs, cx, cy: 0.5, visible: true, interactionType };
}

describe("alignCursorSamplesToCaptureStart", () => {
	it("collapses helper warm-up into one position-only t=0 anchor", () => {
		const result = alignCursorSamplesToCaptureStart(
			[
				sample(0, 0.1),
				sample(30, 0.2),
				sample(60, 0.3, "click"),
				sample(90, 0.4),
				sample(120, 0.5),
			],
			75,
		);

		expect(result.map((point) => point.timeMs)).toEqual([0, 15, 45]);
		expect(result[0]).toMatchObject({ cx: 0.3, interactionType: "move" });
	});

	it("keeps a real sample exactly at capture start without adding a duplicate", () => {
		const result = alignCursorSamplesToCaptureStart(
			[sample(20, 0.1), sample(50, 0.2, "click"), sample(80, 0.3)],
			50,
		);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ timeMs: 0, cx: 0.2, interactionType: "click" });
		expect(result[1].timeMs).toBe(30);
	});

	it("sorts data and leaves timestamps unchanged when no shift is needed", () => {
		const result = alignCursorSamplesToCaptureStart(
			[sample(30, 0.3), sample(10, 0.1), sample(20, 0.2)],
			0,
		);
		expect(result.map((point) => point.timeMs)).toEqual([10, 20, 30]);
	});
});
