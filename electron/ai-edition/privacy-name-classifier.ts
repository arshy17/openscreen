export interface PrivacyNameCandidateInput {
	id: string;
	text: string;
}

export interface PrivacyNameClassification {
	nameCandidateIds: string[];
}

interface OpenAiCompatibleResponse {
	choices?: Array<{ message?: { content?: unknown } }>;
}

function parseJsonObject(content: string): unknown {
	const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
	const unfenced = withoutThinking.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const start = unfenced.indexOf("{");
	const end = unfenced.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("The local model did not return a JSON object.");
	return JSON.parse(unfenced.slice(start, end + 1));
}

/**
 * Ask an already-configured loopback OpenAI-compatible model to classify only
 * OCR strings that might be person names. This function proposes ids; it never
 * writes a document or selects a privacy mask.
 */
export async function classifyPrivacyNamesWithLocalModel(options: {
	baseUrl: string;
	model: string;
	candidates: PrivacyNameCandidateInput[];
	fetchImpl?: typeof fetch;
}): Promise<PrivacyNameClassification> {
	const candidates = options.candidates
		.filter((item) => item.id.trim() && item.text.trim())
		.slice(0, 120)
		.map((item) => ({ id: item.id.slice(0, 160), text: item.text.trim().slice(0, 80) }));
	if (candidates.length === 0) return { nameCandidateIds: [] };
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		signal: AbortSignal.timeout(60_000),
		body: JSON.stringify({
			model: options.model,
			stream: false,
			think: false,
			temperature: 0,
			max_tokens: 512,
			response_format: { type: "json_object" },
			messages: [
				{
					role: "system",
					content:
						'Classify likely natural-person names in OCR snippets. Omit companies, products, places, headings, common words, and anything uncertain. Return only JSON: {"nameCandidateIds":["id"]} using ids from the input.',
				},
				{ role: "user", content: JSON.stringify({ candidates }) },
			],
		}),
	});
	if (!response.ok) throw new Error(`The local model returned HTTP ${response.status}.`);
	const payload = (await response.json()) as OpenAiCompatibleResponse;
	const content = payload.choices?.[0]?.message?.content;
	if (typeof content !== "string") throw new Error("The local model returned no classification.");
	const parsed = parseJsonObject(content) as { nameCandidateIds?: unknown };
	const allowed = new Set(candidates.map((item) => item.id));
	const ids = Array.isArray(parsed.nameCandidateIds)
		? parsed.nameCandidateIds.filter(
				(value): value is string => typeof value === "string" && allowed.has(value),
			)
		: [];
	return { nameCandidateIds: [...new Set(ids)].slice(0, candidates.length) };
}
