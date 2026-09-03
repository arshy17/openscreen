import { documentSchema } from "../../../src/lib/ai-edition/schema";
import type {
	AiEditionAssetResult,
	AiEditionCaptionTranslateResult,
	AiEditionChatBudget,
	AiEditionChatCompactResult,
	AiEditionChatMessage,
	AiEditionChatResult,
	AiEditionChatRewindResult,
	AiEditionChatSession,
	AiEditionChatSessionSummary,
	AiEditionDocumentResult,
	AiEditionLlmConfig,
	AiEditionLlmDisconnectResult,
	AiEditionLlmSnapshot,
	AiEditionPortableProjectResult,
	AiEditionPrivacyNameClassificationResult,
	AiEditionProjectMediaImportRequest,
	AiEditionProjectMediaImportResult,
	AiEditionProjectSnapshotSummary,
	AiEditionProjectSummary,
	AiEditionSnapshotReason,
	ArtworkCutoutResult,
	ArtworkFrameCandidate,
	ArtworkSuggestionResult,
} from "../../../src/native/contracts";
import {
	captureArtworkFrame,
	createArtworkSubjectCutout,
	generateArtworkFrameCandidates,
} from "../../ai-edition/artwork-service";
import { suggestArtworkLocally } from "../../ai-edition/artwork-suggestions";
import {
	type CaptionTranslateSegment,
	translateCaptionSegments,
} from "../../ai-edition/caption-translate";
import type { ChatEventSink } from "../../ai-edition/chat-service";
import type { DocumentService } from "../../ai-edition/document-service";
import type { LlmConfigStore, LlmCredential } from "../../ai-edition/llm-config-store";
import {
	listAnthropicModels,
	listGoogleModels,
	listMistralModels,
	listOpenAiCompatibleModels,
	listOpenRouterModels,
	probeMiniMaxModels,
} from "../../ai-edition/llm-provider-auth";
import { classifyPrivacyNamesWithLocalModel } from "../../ai-edition/privacy-name-classifier";
import { isLocalOpenAICompatible, PROVIDER_DEFINITIONS } from "../../ai-edition/provider-registry";
import type { ProjectMediaImportProgress } from "../../media/projectMediaImport";

export interface AiEditionServiceOptions {
	documents: DocumentService;
	/**
	 * The renderer may name files, but it cannot grant itself filesystem access.
	 * The main process owns the user-approved path set and managed-project roots,
	 * so every path that enters a document must pass through this gate.
	 */
	authorizeMediaPath: (projectId: string, filePath: string) => boolean;
	/**
	 * A factory, not an instance: building `LlmConfigStore` does two sync
	 * readFileSync plus a `safeStorage` decrypt, and on macOS that decrypt is
	 * backed by a Keychain item — so resolving it while wiring the bridge made
	 * every app launch prompt for Keychain access, including for users who never
	 * open the AI layer. The caller memoises, so this still yields one instance.
	 * Nothing here may call it at construction time; every use sits behind a
	 * method the renderer has to invoke first.
	 */
	llmConfig: () => LlmConfigStore;
	runChat: (
		projectId: string,
		sessionId: string,
		message: string,
		document?: unknown,
		sink?: ChatEventSink,
	) => Promise<AiEditionChatResult>;
	rewindToMessage: (
		projectId: string,
		sessionId: string,
		messageId: string,
	) =>
		| {
				success: true;
				prompt: string;
				document: unknown;
				messages: AiEditionChatMessage[];
		  }
		| { success: false; error: string };
	compactNow: (projectId: string, sessionId: string) => Promise<AiEditionChatCompactResult | null>;
	getContextUsage: (
		projectId: string,
		sessionId: string,
	) => {
		usedTokens: number;
		budgetTokens: number;
		ratio: number;
		fillPercent: number;
	} | null;
	// ponytail: legacy per-batch undo retired in favor of per-message rewind.
	// Kept on the surface for IPC compatibility; always returns success=false.
	undoLastToolBatch: (projectId: string, sessionId: string) => AiEditionChatResult;
	listSessions: (projectId: string) => AiEditionChatSessionSummary[];
	createSession: (projectId: string, title?: string) => AiEditionChatSessionSummary;
	selectSession: (projectId: string, sessionId: string) => AiEditionChatSession | null;
	renameSession: (
		projectId: string,
		sessionId: string,
		title: string,
	) => AiEditionChatSessionSummary | null;
	deleteSession: (projectId: string, sessionId: string) => boolean;
}

export class AiEditionService {
	constructor(private readonly options: AiEditionServiceOptions) {}

	private llmConfigInstance: LlmConfigStore | null = null;

	/**
	 * Resolves the store on first use, then holds it — `llmGetSnapshot` alone
	 * reads it once per provider definition. See `AiEditionServiceOptions.llmConfig`.
	 */
	private get llmConfig(): LlmConfigStore {
		if (!this.llmConfigInstance) {
			this.llmConfigInstance = this.options.llmConfig();
		}
		return this.llmConfigInstance;
	}

	async listProjects(): Promise<AiEditionProjectSummary[]> {
		return this.options.documents.listProjects();
	}

	async get(projectId: string): Promise<AiEditionDocumentResult> {
		try {
			const document = await this.options.documents.getProject(projectId);
			return { success: true, document };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async create(title?: string): Promise<AiEditionDocumentResult> {
		try {
			const document = await this.options.documents.createProject(title ?? "");
			return { success: true, document };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async save(document: unknown): Promise<AiEditionDocumentResult> {
		try {
			const parsed = documentSchema.parse(document);
			const saved = await this.options.documents.saveProject(parsed);
			return { success: true, document: saved };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async deleteProject(projectId: string): Promise<AiEditionDocumentResult> {
		try {
			await this.options.documents.deleteProject(projectId);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async addAsset(projectId: string, path: string, label?: string): Promise<AiEditionAssetResult> {
		if (!this.options.authorizeMediaPath(projectId, path)) {
			throw new Error("Media path has not been approved.");
		}
		const document = await this.options.documents.addAsset(projectId, {
			path,
			label,
		});
		const assetId = document.project.primaryAssetId ?? document.assets.at(-1)?.id ?? "";
		return { assetId, document };
	}

	async importProjectMedia(
		request: AiEditionProjectMediaImportRequest,
		options: {
			signal?: AbortSignal;
			onProgress?: (progress: ProjectMediaImportProgress) => void;
		} = {},
	): Promise<AiEditionProjectMediaImportResult> {
		if (
			request.paths.some(
				(filePath) => !this.options.authorizeMediaPath(request.projectId, filePath),
			)
		) {
			throw new Error("One or more media paths have not been approved.");
		}
		return this.options.documents.importProjectMedia(request, options);
	}

	async generateArtworkCandidates(
		projectId: string,
		assetId: string,
		count?: number,
	): Promise<ArtworkFrameCandidate[]> {
		return generateArtworkFrameCandidates(this.options.documents, projectId, assetId, count);
	}

	async captureArtworkFrame(
		projectId: string,
		assetId: string,
		timeSec: number,
	): Promise<ArtworkFrameCandidate> {
		return captureArtworkFrame(this.options.documents, projectId, assetId, timeSec);
	}

	async createArtworkSubjectCutout(
		projectId: string,
		artworkAssetId: string,
	): Promise<ArtworkCutoutResult> {
		return createArtworkSubjectCutout(this.options.documents, projectId, artworkAssetId);
	}

	async suggestArtwork(projectId: string, instructions?: string): Promise<ArtworkSuggestionResult> {
		const document = await this.options.documents.getProject(projectId);
		const config = this.llmConfig.getConfig();
		if (config && !isLocalOpenAICompatible(config.provider, config.baseUrl)) {
			return {
				success: false,
				localOnly: true,
				variants: [],
				error:
					"Artwork suggestions are local-only. Select the loopback OpenAI Compatible provider.",
			};
		}
		return suggestArtworkLocally(document, config, instructions);
	}

	async removeAsset(projectId: string, assetId: string): Promise<AiEditionAssetResult> {
		const document = await this.options.documents.removeAsset(projectId, assetId);
		return { assetId, document };
	}

	async listSnapshots(projectId: string): Promise<AiEditionProjectSnapshotSummary[]> {
		return this.options.documents.listSnapshots(projectId);
	}

	async createSnapshot(
		projectId: string,
		label?: string,
		reason?: AiEditionSnapshotReason,
	): Promise<AiEditionProjectSnapshotSummary> {
		return this.options.documents.createSnapshot(projectId, label, reason);
	}

	async restoreSnapshot(projectId: string, snapshotId: string): Promise<AiEditionDocumentResult> {
		try {
			const document = await this.options.documents.restoreSnapshot(projectId, snapshotId);
			return { success: true, document };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async collectMedia(projectId: string): Promise<AiEditionPortableProjectResult> {
		return this.options.documents.collectProjectMedia(projectId);
	}

	async llmGetSnapshot(): Promise<AiEditionLlmSnapshot> {
		const config = this.llmConfig.getConfig();
		const localNoAuth = isLocalOpenAICompatible(config?.provider, config?.baseUrl);
		const credentialSummary: AiEditionLlmSnapshot["credentialSummary"] = [];
		const connectedProviders: string[] = [];
		for (const def of PROVIDER_DEFINITIONS) {
			// Do not ask the Keychain about unrelated cloud providers while a
			// loopback model is active. Switching providers still resolves their
			// credentials on demand; the local editor simply has no secret to read.
			const resolved = localNoAuth ? null : this.llmConfig.getCredential(def.id, def.envKeys);
			const connected = Boolean(resolved) || (localNoAuth && def.id === "openai-compatible");
			if (connected) connectedProviders.push(def.id);
			credentialSummary.push({
				providerId: def.id,
				connected,
				authKind: def.authKind,
				credentialKind: resolved ? resolved.entry.kind : null,
			});
		}
		return {
			config,
			connectedProviders,
			availableProviders: PROVIDER_DEFINITIONS.map((d) => ({
				id: d.id,
				label: d.label,
				authKind: d.authKind,
			})),
			credentialSummary,
		};
	}

	async llmSetConfig(config: AiEditionLlmConfig): Promise<AiEditionDocumentResult> {
		try {
			await this.llmConfig.setConfig(config);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async llmSetApiKey(providerId: string, apiKey: string): Promise<AiEditionDocumentResult> {
		try {
			const entry: LlmCredential = { kind: "api-key", apiKey };
			await this.llmConfig.setCredential(providerId, entry);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async llmRemoveApiKey(providerId: string): Promise<AiEditionDocumentResult> {
		try {
			await this.llmConfig.removeCredential(providerId);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async llmDisconnect(providerId: string): Promise<AiEditionLlmDisconnectResult> {
		await this.llmConfig.removeCredential(providerId);
		const active = this.llmConfig.getConfig();
		if (active?.provider === providerId) {
			await this.llmConfig.setConfig({
				provider: "",
				model: "",
			});
		}
		return { success: true, snapshot: await this.llmGetSnapshot() };
	}

	async llmListProviderModels(providerId: string): Promise<{ models: string[]; error?: string }> {
		try {
			const def = PROVIDER_DEFINITIONS.find((d) => d.id === providerId);
			if (!def) return { models: [], error: `Unknown provider ${providerId}` };
			const config = this.llmConfig.getConfig();
			const baseUrl = (config?.provider === providerId ? config.baseUrl : undefined) ?? def.baseUrl;
			const localNoAuth = isLocalOpenAICompatible(providerId, baseUrl);
			if (localNoAuth) {
				if (!baseUrl) return { models: [], error: "Missing base URL" };
				return { models: await listOpenAiCompatibleModels(baseUrl) };
			}
			const cred = this.llmConfig.getCredential(providerId, def.envKeys);
			if (!cred) return { models: [], error: "Not connected" };

			if (providerId === "anthropic") {
				return { models: await listAnthropicModels(cred.value) };
			}
			if (providerId === "google") {
				return { models: await listGoogleModels(cred.value) };
			}
			if (providerId === "mistral") {
				return { models: await listMistralModels(cred.value) };
			}
			if (providerId === "openrouter") {
				return { models: await listOpenRouterModels() };
			}
			if (providerId === "minimax" || providerId === "minimax-token-plan") {
				return { models: await probeMiniMaxModels(cred.value, baseUrl) };
			}
			if (providerId === "openai" || providerId === "openai-compatible") {
				if (!baseUrl) return { models: [], error: "Missing base URL" };
				return {
					models: await listOpenAiCompatibleModels(baseUrl, cred.value),
				};
			}
			return {
				models: [],
				error: `Provider ${providerId} does not expose a dynamic model list`,
			};
		} catch (error) {
			return {
				models: [],
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async classifyPrivacyNames(
		candidates: Array<{ id: string; text: string }>,
	): Promise<AiEditionPrivacyNameClassificationResult> {
		const config = this.llmConfig.getConfig();
		if (!config || !isLocalOpenAICompatible(config.provider, config.baseUrl)) {
			return {
				success: false,
				nameCandidateIds: [],
				error: "Configure a loopback OpenAI-compatible local model before classifying names.",
			};
		}
		if (!config.baseUrl || !config.model) {
			return {
				success: false,
				nameCandidateIds: [],
				error: "The local model base URL and model name are required.",
			};
		}
		try {
			const result = await classifyPrivacyNamesWithLocalModel({
				baseUrl: config.baseUrl,
				model: config.model,
				candidates,
			});
			return { success: true, model: config.model, ...result };
		} catch (error) {
			return {
				success: false,
				nameCandidateIds: [],
				model: config.model,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async chatRun(
		projectId: string,
		sessionId: string,
		message: string,
		document?: unknown,
		sink?: ChatEventSink,
	): Promise<AiEditionChatResult> {
		return this.options.runChat(projectId, sessionId, message, document, sink);
	}

	chatUndoLastBatch(_projectId: string, _sessionId: string): AiEditionChatResult {
		return {
			success: false,
			error: "Per-tool-batch undo retired in favor of per-message rewind.",
		};
	}

	chatRewindToMessage(
		projectId: string,
		sessionId: string,
		messageId: string,
	): AiEditionChatRewindResult | { success: false; error: string } {
		return this.options.rewindToMessage(projectId, sessionId, messageId);
	}

	chatContextUsage(projectId: string, sessionId: string): AiEditionChatBudget | null {
		return this.options.getContextUsage(projectId, sessionId);
	}

	chatCompactNow(projectId: string, sessionId: string): Promise<AiEditionChatCompactResult | null> {
		return this.options.compactNow(projectId, sessionId);
	}

	chatListSessions(projectId: string): AiEditionChatSessionSummary[] {
		return this.options.listSessions(projectId);
	}

	chatCreateSession(projectId: string, title?: string): AiEditionChatSessionSummary {
		return this.options.createSession(projectId, title);
	}

	chatSelectSession(projectId: string, sessionId: string): AiEditionChatSession | null {
		return this.options.selectSession(projectId, sessionId);
	}

	chatRenameSession(
		projectId: string,
		sessionId: string,
		title: string,
	): AiEditionChatSessionSummary | null {
		return this.options.renameSession(projectId, sessionId, title);
	}

	chatDeleteSession(projectId: string, sessionId: string): { success: boolean } {
		return { success: this.options.deleteSession(projectId, sessionId) };
	}

	chatMessages(projectId: string, sessionId: string): AiEditionChatMessage[] {
		const session = this.options.selectSession(projectId, sessionId);
		return session?.messages ?? [];
	}

	chatBudget(projectId: string, sessionId: string): AiEditionChatBudget | null {
		const usage = this.options.getContextUsage(projectId, sessionId);
		if (!usage) return null;
		return {
			usedTokens: usage.usedTokens,
			budgetTokens: usage.budgetTokens,
			ratio: usage.ratio,
			fillPercent: usage.fillPercent,
		};
	}

	async chatCompact(
		projectId: string,
		sessionId: string,
	): Promise<AiEditionChatCompactResult | null> {
		const result = await this.options.compactNow(projectId, sessionId);
		if (!result) return null;
		return result;
	}

	/**
	 * Translate transcript segments for the caption layer, using whichever
	 * provider/model the chat is already configured with. Returns a plain
	 * `segmentId → text` map: the caller writes it into the document's caption
	 * translation layer, so nothing here can touch the transcript SSOT.
	 */
	async captionsTranslate(input: {
		segments: CaptionTranslateSegment[];
		targetLanguage: string;
		sourceLanguage?: string;
	}): Promise<AiEditionCaptionTranslateResult> {
		const config = this.llmConfig.getConfig();
		if (!config) {
			return {
				success: false,
				segments: {},
				error: "No AI provider is configured. Connect one in the agent settings first.",
			};
		}
		const def = PROVIDER_DEFINITIONS.find((d) => d.id === config.provider);
		const credential = def ? this.llmConfig.getCredential(def.id, def.envKeys) : null;
		const result = await translateCaptionSegments({
			segments: input.segments,
			targetLanguage: input.targetLanguage,
			sourceLanguage: input.sourceLanguage,
			provider: config.provider,
			model: config.model,
			apiKey: credential?.value ?? "",
			baseUrl: config.baseUrl,
			reasoningEffort: config.reasoningEffort,
		});
		return { ...result, model: config.model };
	}
}
