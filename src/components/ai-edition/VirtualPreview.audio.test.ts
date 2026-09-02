import { describe, expect, it } from "vitest";
import {
	applyPreviewAudioSettings,
	backgroundMusicEnvelope,
	type PreviewAudioGraph,
	previewEnhancementParameters,
	resolveAudioTrackPlayback,
} from "./VirtualPreview";

/** Minimal stand-in: the function only ever touches `gain.gain.value`. */
function fakeGraph(): PreviewAudioGraph {
	return {
		context: {} as AudioContext,
		gain: { gain: { value: Number.NaN } } as GainNode,
		musicGain: { gain: { value: Number.NaN } } as GainNode,
	};
}

describe("resolveAudioTrackPlayback", () => {
	it("mirrors the video's time", () => {
		expect(resolveAudioTrackPlayback(1, 10)).toEqual({ targetTimeSec: 1, shouldPlay: true });
	});

	it("parks at the end of a track that is shorter than the video", () => {
		// The supplemental track is extracted separately, so it can run out before the
		// video does; seeking past its end leaves the element stuck in `seeking`.
		expect(resolveAudioTrackPlayback(12, 10)).toEqual({ targetTimeSec: 10, shouldPlay: false });
	});

	it("treats a zero-length track as already ended", () => {
		// An empty extraction is a KNOWN length, not an unknown one. Reading it as
		// unknown parks the element at the video's time with shouldPlay true, and the
		// rAF loop then seeks and calls play() on it for the whole timeline.
		expect(resolveAudioTrackPlayback(1, 0)).toEqual({ targetTimeSec: 0, shouldPlay: false });
	});

	it("plays while the duration is still unknown", () => {
		expect(resolveAudioTrackPlayback(1, Number.NaN)).toEqual({
			targetTimeSec: 1,
			shouldPlay: true,
		});
		// A negative duration is not a length either — same fallback as NaN.
		expect(resolveAudioTrackPlayback(1, -1)).toEqual({ targetTimeSec: 1, shouldPlay: true });
	});

	it("never seeks to a negative time", () => {
		expect(resolveAudioTrackPlayback(-0.5, 10)).toEqual({ targetTimeSec: 0, shouldPlay: false });
	});
});

describe("applyPreviewAudioSettings", () => {
	// This is the PR's parity claim, on the preview side. `finish_audio` applies
	// `10f32.powf(gain_db / 20.0)` per sample natively and has its own test pinning that
	// identity; if these two ever disagree, the editor stops meaning what it plays.
	it("feeds the gain node the same scalar the export applies", () => {
		for (const gainDb of [-12, -6.0206, 0, 6.0206, 12]) {
			const graph = fakeGraph();
			applyPreviewAudioSettings(graph, [], gainDb);
			expect(graph.gain.gain.value).toBeCloseTo(10 ** (gainDb / 20), 6);
		}
	});

	it("caps the element-volume fallback at unity, which is why the gain node exists", () => {
		const element = { volume: Number.NaN } as HTMLAudioElement;

		// Attenuation survives the fallback intact...
		applyPreviewAudioSettings(null, [element, null], -6.0206);
		expect(element.volume).toBeCloseTo(0.5, 4);

		// ...but `HTMLMediaElement.volume` has no headroom above 1, so a boost is lost
		// wherever WebAudio is unavailable. Degraded on purpose, not silent.
		applyPreviewAudioSettings(null, [element], 6.0206);
		expect(element.volume).toBe(1);
	});

	it("leaves the elements alone once the graph is carrying the gain", () => {
		// Their audio no longer reaches the default output, so `volume` would only
		// scale the signal a second time on its way into the node.
		const graph = fakeGraph();
		const element = { volume: 0.25 } as HTMLAudioElement;
		applyPreviewAudioSettings(graph, [element], -6.0206);
		expect(element.volume).toBe(0.25);
		expect(graph.gain.gain.value).toBeCloseTo(0.5, 4);
	});

	it("keeps soundtrack and programme levels independent inside the graph", () => {
		const graph = fakeGraph();
		applyPreviewAudioSettings(graph, [], -3, null, -18);
		expect(graph.gain.gain.value).toBeCloseTo(10 ** (-3 / 20), 6);
		expect(graph.musicGain.gain.value).toBeCloseTo(10 ** (-18 / 20), 6);
	});
});

describe("backgroundMusicEnvelope", () => {
	it("fades in and out against programme time", () => {
		expect(backgroundMusicEnvelope(0, 10, 2, 2)).toBe(0);
		expect(backgroundMusicEnvelope(1, 10, 2, 2)).toBe(0.5);
		expect(backgroundMusicEnvelope(5, 10, 2, 2)).toBe(1);
		expect(backgroundMusicEnvelope(9, 10, 2, 2)).toBe(0.5);
		expect(backgroundMusicEnvelope(10, 10, 2, 2)).toBe(0);
	});

	it("does not fade when the controls are zero", () => {
		expect(backgroundMusicEnvelope(0, 10, 0, 0)).toBe(1);
		expect(backgroundMusicEnvelope(10, 10, 0, 0)).toBe(1);
	});
});

describe("previewEnhancementParameters", () => {
	it("clamps intensity and keeps the three local presets distinct", () => {
		const clarity = previewEnhancementParameters("clarity", 0.5);
		const podcast = previewEnhancementParameters("podcast", 0.5);
		const broadcast = previewEnhancementParameters("broadcast", 2);
		expect(clarity.ratio).toBeLessThan(podcast.ratio);
		expect(podcast.cutoffHz).toBeLessThan(broadcast.cutoffHz);
		expect(broadcast).toEqual(previewEnhancementParameters("broadcast", 1));
	});
});
