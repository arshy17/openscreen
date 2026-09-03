import { describe, expect, it } from "vitest";
import { languageLabel, sortedLanguageOptions } from "./languageLabels";

describe("transcription language labels", () => {
	it("makes the Persian / Farsi option explicit and searchable", () => {
		const label = languageLabel("fa", "en");
		expect(label).toContain("Persian");
		expect(label).toContain("Farsi");
		expect(label).toContain("فارسی");
	});

	it("offers fa in the complete local Whisper language picker", () => {
		const options = sortedLanguageOptions("en", "Auto");
		expect(options[0]).toEqual({ code: "auto", label: "Auto" });
		expect(options.find((option) => option.code === "fa")?.label).toContain("فارسی");
	});
});
