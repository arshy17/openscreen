import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import type { ArtworkSuggestionResult, ArtworkSuggestionVariant } from "../../src/native/contracts";
import { createOpenScreenChatModel, messageContentToText } from "./deep-agent/chat-model";
import type { LlmConfig } from "./llm-config-store";

const variantSchema = z.object({
	id: z.string().min(1),
	headline: z.string().trim().min(1).max(90),
	subtitle: z.string().trim().max(140).optional(),
	layout: z.enum(["subject-left", "subject-right", "centered"]),
	accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
	evidence: z.string().trim().min(1).max(240),
	confidence: z.number().min(0).max(1),
});
const suggestionSchema = z.object({ variants: z.array(variantSchema).length(3) });

function transcriptText(document: AxcutDocument): string {
	const transcripts =
		document.transcripts.length > 0
			? document.transcripts
			: document.transcript
				? [document.transcript]
				: [];
	return transcripts
		.flatMap((transcript) =>
			transcript.segments
				.filter((segment) => segment.kind === "speech")
				.map((segment) => segment.text),
		)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 8_000);
}

function deterministic(document: AxcutDocument): ArtworkSuggestionVariant[] {
	const title = document.project.title.trim() || "Your video";
	const words = transcriptText(document).split(/\s+/).filter(Boolean);
	const hook = words.slice(0, 7).join(" ") || title;
	return [
		{
			id: "local-template-bold",
			headline: title.slice(0, 72),
			layout: "subject-right",
			accentColor: "#2563eb",
			evidence: "Uses the project title.",
			confidence: 0.55,
		},
		{
			id: "local-template-hook",
			headline: hook.slice(0, 72),
			layout: "subject-left",
			accentColor: "#e11d48",
			evidence: words.length
				? "Uses the opening transcript words."
				: "Uses the project title because no transcript exists.",
			confidence: 0.5,
		},
		{
			id: "local-template-clean",
			headline: `Watch: ${title}`.slice(0, 72),
			layout: "centered",
			accentColor: "#059669",
			evidence: "A restrained deterministic layout; no AI model was used.",
			confidence: 0.45,
		},
	];
}

function parseReply(value: string): ArtworkSuggestionVariant[] {
	const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const source = fenced ?? value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
	return suggestionSchema.parse(JSON.parse(source)).variants;
}

export async function suggestArtworkLocally(
	document: AxcutDocument,
	config: LlmConfig | null,
	instructions = "",
): Promise<ArtworkSuggestionResult> {
	if (!config?.baseUrl || !config.model || config.provider !== "openai-compatible") {
		return {
			success: true,
			localOnly: true,
			variants: deterministic(document),
			error: "Local Qwen is not configured, so reviewable built-in layouts are shown instead.",
		};
	}
	try {
		const model = await createOpenScreenChatModel({
			provider: config.provider,
			baseUrl: config.baseUrl,
			model: config.model,
			reasoningEffort: "low",
		});
		const result = await model.invoke([
			new SystemMessage(
				"You are a restrained thumbnail art director running locally. Return only JSON. Do not invent claims, people, assets, or facts. Produce exactly three distinct, concise, schema-valid variants.",
			),
			new HumanMessage(
				JSON.stringify({
					schema: {
						variants: [
							{
								id: "string",
								headline: "max 90 chars",
								subtitle: "optional max 140",
								layout: "subject-left|subject-right|centered",
								accentColor: "#RRGGBB",
								evidence: "source-grounded explanation",
								confidence: "0..1",
							},
						],
					},
					projectTitle: document.project.title,
					transcript: transcriptText(document),
					instructions: instructions.slice(0, 1_000),
				}),
			),
		]);
		return {
			success: true,
			localOnly: true,
			model: config.model,
			variants: parseReply(messageContentToText(result.content)),
		};
	} catch (error) {
		return {
			success: true,
			localOnly: true,
			model: config.model,
			variants: deterministic(document),
			error: `Local model suggestion failed; built-in layouts are shown instead. ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
