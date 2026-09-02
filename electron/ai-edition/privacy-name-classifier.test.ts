import { describe, expect, it, vi } from "vitest";
import { classifyPrivacyNamesWithLocalModel } from "./privacy-name-classifier";

describe("local privacy name classification", () => {
	it("accepts only ids from the bounded OCR input", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content:
										'```json\n{"nameCandidateIds":["candidate-2","invented","candidate-2"]}\n```',
								},
							},
						],
					}),
				),
		);
		const result = await classifyPrivacyNamesWithLocalModel({
			baseUrl: "http://127.0.0.1:11434/v1/",
			model: "qwen3.8:27b-q6_k-64k",
			candidates: [
				{ id: "candidate-1", text: "Open Screen" },
				{ id: "candidate-2", text: "Arshia Movahedi" },
			],
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result.nameCandidateIds).toEqual(["candidate-2"]);
		expect(fetchImpl).toHaveBeenCalledWith(
			"http://127.0.0.1:11434/v1/chat/completions",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("returns no proposal when no OCR text is available", async () => {
		const fetchImpl = vi.fn();
		expect(
			await classifyPrivacyNamesWithLocalModel({
				baseUrl: "http://localhost:11434/v1",
				model: "qwen",
				candidates: [],
				fetchImpl: fetchImpl as typeof fetch,
			}),
		).toEqual({ nameCandidateIds: [] });
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
