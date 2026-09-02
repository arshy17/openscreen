import { removeCaptionTranslationsForAsset } from "../captions/translations";
import type { AxcutDocument } from "../schema";

/**
 * Correct one timed transcript word without changing its timing or identity.
 * Captions are derived from `transcript.words`, while translation units are
 * derived from `transcript.segments`, so both representations must move in the
 * same document write.
 */
export function updateTranscriptWordText(
	document: AxcutDocument,
	assetId: string,
	wordId: string,
	text: string,
): AxcutDocument {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return document;

	const transcriptIndex = document.transcripts.findIndex((entry) => entry.assetId === assetId);
	if (transcriptIndex < 0) return document;
	const transcript = document.transcripts[transcriptIndex];
	const originalWord = transcript.words.find((word) => word.id === wordId);
	if (!originalWord || originalWord.text === normalized) return document;

	const words = transcript.words.map((word) =>
		word.id === wordId ? { ...word, text: normalized } : word,
	);
	const wordsById = new Map(words.map((word) => [word.id, word]));
	const segments = transcript.segments.map((segment) => {
		if (segment.id !== originalWord.segmentId && !segment.wordIds.includes(wordId)) return segment;
		const wordIds =
			segment.wordIds.length > 0
				? segment.wordIds
				: words.filter((word) => word.segmentId === segment.id).map((word) => word.id);
		const segmentText = wordIds
			.map((id) => wordsById.get(id)?.text ?? "")
			.filter(Boolean)
			.join(" ");
		return { ...segment, text: segmentText || normalized };
	});

	const transcripts = [...document.transcripts];
	const updatedTranscript = { ...transcript, words, segments };
	transcripts[transcriptIndex] = updatedTranscript;
	return removeCaptionTranslationsForAsset(
		{
			...document,
			transcript:
				document.transcript?.assetId === assetId ? updatedTranscript : document.transcript,
			transcripts,
		},
		assetId,
	);
}
