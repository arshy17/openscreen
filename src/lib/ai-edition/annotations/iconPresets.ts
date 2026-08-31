/**
 * Built-in annotation glyphs that render through the existing text pipeline.
 *
 * Keeping these as text (rather than remote images or an icon-font dependency)
 * means they work offline, stay editable, inherit every text animation, and use
 * the exact same preview/export path on macOS, Windows, and Linux.
 */
export const ANNOTATION_ICON_PRESETS = [
	{ id: "sparkles", glyph: "✦" },
	{ id: "star", glyph: "★" },
	{ id: "check", glyph: "✓" },
	{ id: "arrow", glyph: "→" },
	{ id: "heart", glyph: "♥" },
	{ id: "warning", glyph: "!" },
	{ id: "target", glyph: "◎" },
	{ id: "dot", glyph: "●" },
	{ id: "idea", glyph: "💡" },
	{ id: "fire", glyph: "🔥" },
	{ id: "celebrate", glyph: "🎉" },
	{ id: "thumbs-up", glyph: "👍" },
	{ id: "question", glyph: "?" },
	{ id: "lightning", glyph: "⚡" },
] as const;

export type AnnotationIconPreset = (typeof ANNOTATION_ICON_PRESETS)[number]["id"];

export const ANNOTATION_ICON_VALUES = ANNOTATION_ICON_PRESETS.map((preset) => preset.id) as [
	AnnotationIconPreset,
	...AnnotationIconPreset[],
];

const GLYPH_BY_ID = new Map<AnnotationIconPreset, string>(
	ANNOTATION_ICON_PRESETS.map((preset) => [preset.id, preset.glyph]),
);

export function annotationIconGlyph(preset: AnnotationIconPreset): string {
	return GLYPH_BY_ID.get(preset) ?? "✦";
}
