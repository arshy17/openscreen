import { describe, expect, it, vi } from "vitest";
import { showOpenDialogWithParent, showSaveDialogWithParent } from "./nativeDialogs";

const options = { title: "Choose a file" };

function parent(destroyed = false) {
	return { isDestroyed: () => destroyed };
}

describe("native dialog parenting", () => {
	it("passes a live parent through Electron's open-dialog overload", async () => {
		const showOpenDialog = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] });
		const liveParent = parent();
		await showOpenDialogWithParent({ showOpenDialog } as never, options, liveParent as never);
		expect(showOpenDialog).toHaveBeenCalledWith(liveParent, options);
	});

	it("omits a destroyed parent from the open-dialog call", async () => {
		const showOpenDialog = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] });
		await showOpenDialogWithParent({ showOpenDialog } as never, options, parent(true) as never);
		expect(showOpenDialog).toHaveBeenCalledWith(options);
	});

	it("passes a live parent through Electron's save-dialog overload", async () => {
		const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true, filePath: undefined });
		const liveParent = parent();
		await showSaveDialogWithParent({ showSaveDialog } as never, options, liveParent as never);
		expect(showSaveDialog).toHaveBeenCalledWith(liveParent, options);
	});

	it("uses the unparented overload when no editor window exists", async () => {
		const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true, filePath: undefined });
		await showSaveDialogWithParent({ showSaveDialog } as never, options, null);
		expect(showSaveDialog).toHaveBeenCalledWith(options);
	});
});
