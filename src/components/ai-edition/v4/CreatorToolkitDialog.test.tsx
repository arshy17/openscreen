// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, documentSchema } from "@/lib/ai-edition/schema";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { CreatorToolkitDialog } from "./CreatorToolkitDialog";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string) => key,
}));

function documentFixture() {
	const base = createEmptyDocument({
		projectId: "toolkit_ui",
		title: "Toolkit UI",
		createdAt: "2026-09-02T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "source.mp4",
				originalPath: "/tmp/source.mp4",
				durationSec: 20,
				cameraTrack: null,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 20,
					timelineStartSec: 0,
					timelineEndSec: 20,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

beforeEach(() => {
	localStorage.clear();
	useProjectStore.setState({
		projectId: "toolkit_ui",
		document: documentFixture(),
		status: "ready",
	});
});

afterEach(() => {
	cleanup();
	useProjectStore.getState().clear();
});

describe("CreatorToolkitDialog", () => {
	it("opens as a no-write review plan and exposes every optional workspace", () => {
		const before = useProjectStore.getState().document;
		render(<CreatorToolkitDialog open onClose={vi.fn()} />);
		expect(screen.getByRole("dialog", { name: "Creator Toolkit" })).toBeInTheDocument();
		expect(screen.getByText(/Everything here is optional/)).toBeInTheDocument();
		expect(screen.getByText("AI Edit Plan")).toBeInTheDocument();
		expect(useProjectStore.getState().document).toBe(before);

		for (const tab of [
			"Templates",
			"Make clips",
			"Social variants",
			"Layouts",
			"Privacy",
			"Audio",
			"Brand kits",
			"Recovery",
			"Performance",
		]) {
			expect(screen.getByRole("button", { name: tab })).toBeEnabled();
		}
	});

	it("previews a batch of social variants without creating them", () => {
		const before = useProjectStore.getState().document;
		render(<CreatorToolkitDialog open onClose={vi.fn()} initialTab="variants" />);
		expect(screen.getByText("Batch social variants")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Create 3 selected variants/ })).toBeEnabled();
		expect(useProjectStore.getState().document).toBe(before);
	});

	it("shows previews for built-in templates and keeps visuals off", () => {
		render(<CreatorToolkitDialog open onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "Templates" }));
		expect(screen.getByText("Ready-made and reusable templates")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Instagram Reel/ })).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: /Include built-in visuals/ })).not.toBeChecked();
	});

	it("keeps every mastering addition off until the user enables it", () => {
		render(<CreatorToolkitDialog open onClose={vi.fn()} initialTab="audio" />);
		expect(screen.getByRole("checkbox", { name: /Enhance programme voice/ })).not.toBeChecked();
		expect(screen.getByRole("combobox", { name: /Measured export loudness/ })).toHaveValue("off");
		expect(screen.getByRole("checkbox", { name: /Safety limiter/ })).not.toBeChecked();
		expect(screen.getByRole("checkbox", { name: /Automatically lower music/ })).not.toBeChecked();
	});
});
