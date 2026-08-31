export type MacScreenAccessStatus =
	| "not-determined"
	| "granted"
	| "denied"
	| "restricted"
	| "unknown";

export type MacScreenAccessResult = {
	success: boolean;
	granted: boolean;
	status: MacScreenAccessStatus;
	error?: string;
};

type MacScreenAccessDependencies = {
	getStatus: () => MacScreenAccessStatus;
	focusForPrompt: () => void;
	probe: () => Promise<unknown>;
	onProbeError?: (error: unknown) => void;
};

/**
 * Ask macOS to register the current app for screen capture.
 *
 * Electron has no `askForMediaAccess("screen")`. Calling desktopCapturer is
 * the request. In particular, the probe must also run for `denied`: an
 * updated/ad-hoc-signed build can have no entry of its own in System Settings
 * while Electron still reports that status from TCC. Skipping the probe there
 * strands the user with only the previous app identity in the permission list.
 */
export function requestMacScreenAccess({
	getStatus,
	focusForPrompt,
	probe,
	onProbeError,
}: MacScreenAccessDependencies): MacScreenAccessResult {
	try {
		const status = getStatus();
		if (status === "granted") {
			return { success: true, granted: true, status };
		}

		focusForPrompt();
		void Promise.resolve()
			.then(probe)
			.catch((error) => onProbeError?.(error));

		return { success: true, granted: false, status };
	} catch (error) {
		return { success: false, granted: false, status: "unknown", error: String(error) };
	}
}
