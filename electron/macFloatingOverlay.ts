import type { BrowserWindowConstructorOptions } from "electron";

type MacFloatingWindow = Pick<
	Electron.BrowserWindow,
	"setAlwaysOnTop" | "setVisibleOnAllWorkspaces"
>;

type RestorableWindow = Pick<
	Electron.BrowserWindow,
	"focus" | "isMinimized" | "isVisible" | "restore" | "show"
>;

export function macFloatingOverlayOptions(
	platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
	return platform === "darwin" ? { type: "panel", fullscreenable: false } : {};
}

/** Keep presenter surfaces above the active app, including full-screen Spaces. */
export function keepMacFloatingOverlayVisible(
	win: MacFloatingWindow,
	platform: NodeJS.Platform = process.platform,
): void {
	if (platform !== "darwin") return;
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	win.setAlwaysOnTop(true, "screen-saver");
}

/** Focusing a minimized BrowserWindow does not restore it. Re-opening Notes
 *  must therefore make the existing window visible before it receives focus. */
export function showFloatingWindow(win: RestorableWindow): void {
	if (win.isMinimized()) win.restore();
	if (!win.isVisible()) win.show();
	win.focus();
}
