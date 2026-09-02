import { describe, expect, it } from "vitest";
import { parseNativeMacAudioHealth } from "./nativeMacRecording";

const summary = (body: Record<string, unknown>) =>
	JSON.stringify({ event: "audio-timeline", code: "audio-timeline-summary", ...body });

describe("native macOS audio health", () => {
	it("does not warn when audio was intentionally disabled", () => {
		expect(parseNativeMacAudioHealth("", { system: false, microphone: false })).toEqual({
			status: "not-requested",
			trackSeconds: 0,
		});
	});

	it("reports a healthy microphone delivery timeline", () => {
		const result = parseNativeMacAudioHealth(
			summary({
				trackSeconds: 10,
				microphone: {
					undeliveredSeconds: 0.04,
					longestHoleSeconds: 0.04,
					droppedSeconds: 0,
					trimmedSeconds: 0.03,
				},
			}),
			{ system: false, microphone: true },
		);
		expect(result).toMatchObject({ status: "ok", trackSeconds: 10 });
	});

	it("preserves but warns about a source that delivered almost nothing", () => {
		const result = parseNativeMacAudioHealth(
			summary({
				trackSeconds: 10,
				microphone: {
					undeliveredSeconds: 9.9,
					longestHoleSeconds: 9.9,
					droppedSeconds: 0,
					trimmedSeconds: 0,
				},
			}),
			{ system: false, microphone: true },
		);
		expect(result.status).toBe("warning");
		expect(result.warning).toMatch(/almost no audio/i);
	});
});
