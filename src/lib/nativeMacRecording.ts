import type { Rectangle } from "electron";
import type { CursorCaptureMode } from "./recordingSession";

export type NativeMacSourceType = "display" | "window";

export type NativeMacRecordingRequest = {
	schemaVersion: 1;
	recordingId?: number;
	source: {
		type: NativeMacSourceType;
		sourceId: string;
		displayId?: number;
		windowId?: number;
		bounds?: Rectangle;
		/** Electron process ids whose windows must stay visible locally but out of display captures. */
		excludedProcessIds?: number[];
		/** Exact native window ids used when ScreenCaptureKit cannot resolve an excluded process. */
		excludedWindowIds?: number[];
		/** Exclude Finder's desktop layer while leaving desktop icons visible to the user. */
		hideDesktopIcons?: boolean;
	};
	video: {
		fps: number;
		width: number;
		height: number;
		bitrate?: number;
		hideSystemCursor: boolean;
	};
	audio: {
		system: {
			enabled: boolean;
		};
		microphone: {
			enabled: boolean;
			deviceId?: string;
			deviceName?: string;
			gain: number;
		};
	};
	webcam: {
		enabled: boolean;
		deviceId?: string;
		deviceName?: string;
		width: number;
		height: number;
		fps: number;
	};
	cursor: {
		mode: CursorCaptureMode;
	};
	outputs: {
		screenPath: string;
		manifestPath?: string;
	};
};

export type NativeMacHelperReadyEvent = {
	event: "ready";
	schemaVersion: 1;
};

export type NativeMacHelperRecordingStartedEvent = {
	event: "recording-started";
	timestampMs: number;
	captureBounds?: Rectangle;
};

export type NativeMacHelperRecordingStoppedEvent = {
	event: "recording-stopped";
	screenPath: string;
};

export type NativeMacHelperWarningEvent = {
	event: "warning";
	code: string;
	message: string;
};

export type NativeMacHelperErrorEvent = {
	event: "error";
	code: string;
	message: string;
};

export type NativeMacHelperEvent =
	| NativeMacHelperReadyEvent
	| NativeMacHelperRecordingStartedEvent
	| NativeMacHelperRecordingStoppedEvent
	| NativeMacHelperWarningEvent
	| NativeMacHelperErrorEvent;

export type NativeMacRecordingStartResult = {
	success: boolean;
	recordingId?: number;
	path?: string;
	helperPath?: string;
	error?: string;
};

export type NativeMacAudioDelivery = {
	undeliveredSeconds: number;
	longestHoleSeconds: number;
	droppedSeconds: number;
	trimmedSeconds: number;
};

export type NativeMacAudioHealth = {
	status: "ok" | "warning" | "unavailable" | "not-requested";
	trackSeconds: number;
	system?: NativeMacAudioDelivery;
	microphone?: NativeMacAudioDelivery;
	peakAmplitude?: number;
	warning?: string;
};

function finiteNonNegative(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function delivery(value: unknown): NativeMacAudioDelivery | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	const undeliveredSeconds = finiteNonNegative(candidate.undeliveredSeconds);
	const longestHoleSeconds = finiteNonNegative(candidate.longestHoleSeconds);
	const droppedSeconds = finiteNonNegative(candidate.droppedSeconds);
	const trimmedSeconds = finiteNonNegative(candidate.trimmedSeconds);
	if (
		undeliveredSeconds === null ||
		longestHoleSeconds === null ||
		droppedSeconds === null ||
		trimmedSeconds === null
	) {
		return undefined;
	}
	return { undeliveredSeconds, longestHoleSeconds, droppedSeconds, trimmedSeconds };
}

/** Parse the helper's final delivery ledger without trusting arbitrary log text. */
export function parseNativeMacAudioHealth(
	output: string,
	requested: { system: boolean; microphone: boolean },
): NativeMacAudioHealth {
	if (!requested.system && !requested.microphone) {
		return { status: "not-requested", trackSeconds: 0 };
	}
	const event = output
		.split(/\r?\n/)
		.map((line) => {
			try {
				return JSON.parse(line) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter(
			(value): value is Record<string, unknown> =>
				value?.event === "audio-timeline" && value.code === "audio-timeline-summary",
		)
		.at(-1);
	if (!event) {
		return {
			status: "unavailable",
			trackSeconds: 0,
			warning:
				"Audio verification did not finish. The take was preserved; check it before editing.",
		};
	}
	const trackSeconds = finiteNonNegative(event.trackSeconds) ?? 0;
	const system = requested.system ? delivery(event.system) : undefined;
	const microphone = requested.microphone ? delivery(event.microphone) : undefined;
	const missing = (requested.system && !system) || (requested.microphone && !microphone);
	const nearlyAllMissing = [system, microphone]
		.filter((value): value is NativeMacAudioDelivery => Boolean(value))
		.some(
			(value) =>
				trackSeconds <= 0 ||
				value.undeliveredSeconds >= Math.max(trackSeconds - 0.25, trackSeconds * 0.95),
		);
	const longestHole = [system, microphone]
		.filter((value): value is NativeMacAudioDelivery => Boolean(value))
		.some(
			(value) => trackSeconds > 2 && value.longestHoleSeconds >= Math.max(1.5, trackSeconds * 0.5),
		);
	const warning = missing
		? "An enabled audio source did not return a delivery report. The take was preserved; check it before editing."
		: nearlyAllMissing
			? "An enabled audio source delivered almost no audio timeline. The take was preserved for recovery."
			: longestHole
				? "An enabled audio source had a long delivery gap. Review the take before editing."
				: undefined;
	return {
		status: warning ? "warning" : "ok",
		trackSeconds,
		...(system ? { system } : {}),
		...(microphone ? { microphone } : {}),
		...(warning ? { warning } : {}),
	};
}

export function parseMacWindowIdFromSourceId(sourceId?: string | null) {
	if (!sourceId?.startsWith("window:")) {
		return null;
	}

	const windowIdPart = sourceId.split(":")[1];
	if (!windowIdPart || !/^\d+$/.test(windowIdPart)) {
		return null;
	}

	return Number(windowIdPart);
}

export function parseMacDisplayIdFromSourceId(sourceId?: string | null) {
	if (!sourceId?.startsWith("screen:")) {
		return null;
	}

	const displayIdPart = sourceId.split(":")[1];
	if (!displayIdPart || !/^\d+$/.test(displayIdPart)) {
		return null;
	}

	return Number(displayIdPart);
}
