import { describe, expect, it } from "vitest";
import type { AxcutClip } from "../schema";
import { mediaInsertionIndex } from "./media-insertion";

const clips = [
	{ id: "a", timelineStartSec: 0, timelineEndSec: 10 },
	{ id: "b", timelineStartSec: 10, timelineEndSec: 20 },
	{ id: "c", timelineStartSec: 20, timelineEndSec: 30 },
] as AxcutClip[];

describe("mediaInsertionIndex", () => {
	it("inserts on either side of the clip under the playhead", () => {
		expect(mediaInsertionIndex(clips, 14, "before")).toBe(1);
		expect(mediaInsertionIndex(clips, 14, "after")).toBe(2);
	});

	it("uses the selected clip even when the playhead is elsewhere", () => {
		expect(mediaInsertionIndex(clips, 2, "before", "c")).toBe(2);
		expect(mediaInsertionIndex(clips, 2, "after", "c")).toBe(3);
	});

	it("handles an empty timeline and positions outside the timeline", () => {
		expect(mediaInsertionIndex([], 5, "after")).toBe(0);
		expect(mediaInsertionIndex(clips, -2, "before")).toBe(0);
		expect(mediaInsertionIndex(clips, 99, "after")).toBe(3);
	});
});
