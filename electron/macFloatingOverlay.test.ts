import { describe, expect, it, vi } from "vitest";
import {
	keepMacFloatingOverlayVisible,
	macFloatingOverlayOptions,
	showFloatingWindow,
} from "./macFloatingOverlay";

describe("macOS presenter overlays", () => {
	it("uses a panel that can follow full-screen Spaces", () => {
		expect(macFloatingOverlayOptions("darwin")).toEqual({ type: "panel", fullscreenable: false });
		expect(macFloatingOverlayOptions("win32")).toEqual({});
	});

	it("raises the window above whichever application is active", () => {
		const win = {
			setVisibleOnAllWorkspaces: vi.fn(),
			setAlwaysOnTop: vi.fn(),
		};
		keepMacFloatingOverlayVisible(win as never, "darwin");
		expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
			visibleOnFullScreen: true,
		});
		expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
	});

	it("restores an existing minimized Notes window before focusing it", () => {
		const win = {
			isMinimized: vi.fn(() => true),
			restore: vi.fn(),
			isVisible: vi.fn(() => false),
			show: vi.fn(),
			focus: vi.fn(),
		};
		showFloatingWindow(win);
		expect(win.restore).toHaveBeenCalledOnce();
		expect(win.show).toHaveBeenCalledOnce();
		expect(win.focus).toHaveBeenCalledOnce();
	});
});
