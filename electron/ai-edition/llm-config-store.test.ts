import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	isEncryptionAvailable: vi.fn(() => true),
	decryptString: vi.fn(() => JSON.stringify({ "openai-compatible": "unused" })),
	encryptString: vi.fn((value: string) => Buffer.from(value)),
}));

vi.mock("electron", () => ({ safeStorage: mocks }));

import { LlmConfigStore } from "./llm-config-store";

afterEach(() => {
	vi.clearAllMocks();
});

describe("LlmConfigStore local no-auth startup", () => {
	it("does not ask safeStorage to decrypt an unused credential for a loopback model", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "openscreen-local-llm-"));
		try {
			writeFileSync(
				path.join(directory, "llm-config.json"),
				JSON.stringify({
					provider: "openai-compatible",
					model: "qwen3.8:27b-q6_k-64k",
					baseUrl: "http://127.0.0.1:11434/v1",
				}),
			);
			writeFileSync(path.join(directory, "llm-credentials.enc"), "old-preview-credential");

			const store = new LlmConfigStore(directory);

			expect(store.getConfig()?.model).toBe("qwen3.8:27b-q6_k-64k");
			expect(store.getCredential("openai-compatible")).toBeNull();
			expect(mocks.isEncryptionAvailable).not.toHaveBeenCalled();
			expect(mocks.decryptString).not.toHaveBeenCalled();
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
