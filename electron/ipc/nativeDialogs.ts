import type { BrowserWindow } from "electron";

type DialogApi = Pick<typeof import("electron").dialog, "showOpenDialog" | "showSaveDialog">;

/**
 * Keep native panels attached to the editor. Electron accepts the parent as
 * the first overload argument; a `parent` property in the options is ignored.
 */
export function showOpenDialogWithParent(
	dialogApi: DialogApi,
	baseOptions: Electron.OpenDialogOptions,
	parentWindow: BrowserWindow | null,
) {
	if (parentWindow && !parentWindow.isDestroyed()) {
		return dialogApi.showOpenDialog(parentWindow, baseOptions);
	}
	return dialogApi.showOpenDialog(baseOptions);
}

export function showSaveDialogWithParent(
	dialogApi: DialogApi,
	baseOptions: Electron.SaveDialogOptions,
	parentWindow: BrowserWindow | null,
) {
	if (parentWindow && !parentWindow.isDestroyed()) {
		return dialogApi.showSaveDialog(parentWindow, baseOptions);
	}
	return dialogApi.showSaveDialog(baseOptions);
}
