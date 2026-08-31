import { describe, expect, it, vi } from "vitest";
import { requestMacScreenAccess } from "./macScreenAccess";

describe("requestMacScreenAccess", () => {
	it("returns immediately when screen access is already granted", async () => {
		const focusForPrompt = vi.fn();
		const probe = vi.fn(async () => undefined);

		expect(
			requestMacScreenAccess({
				getStatus: () => "granted",
				focusForPrompt,
				probe,
			}),
		).toEqual({ success: true, granted: true, status: "granted" });
		await Promise.resolve();
		expect(focusForPrompt).not.toHaveBeenCalled();
		expect(probe).not.toHaveBeenCalled();
	});

	it.each([
		"not-determined",
		"denied",
		"restricted",
		"unknown",
	] as const)("probes desktop capture when the reported status is %s", async (status) => {
		const focusForPrompt = vi.fn();
		const probe = vi.fn(async () => undefined);

		expect(
			requestMacScreenAccess({
				getStatus: () => status,
				focusForPrompt,
				probe,
			}),
		).toEqual({ success: true, granted: false, status });
		await Promise.resolve();
		expect(focusForPrompt).toHaveBeenCalledTimes(1);
		expect(probe).toHaveBeenCalledTimes(1);
	});

	it("reports status lookup failures without starting a probe", async () => {
		const probe = vi.fn(async () => undefined);

		const result = requestMacScreenAccess({
			getStatus: () => {
				throw new Error("TCC unavailable");
			},
			focusForPrompt: vi.fn(),
			probe,
		});

		expect(result).toEqual({
			success: false,
			granted: false,
			status: "unknown",
			error: "Error: TCC unavailable",
		});
		await Promise.resolve();
		expect(probe).not.toHaveBeenCalled();
	});
});
