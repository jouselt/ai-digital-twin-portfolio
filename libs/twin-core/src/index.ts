export { cosineSimilarity, retrieve, suggestionsFrom, type EmbeddedChunk } from './retrieval';
export {
  CannedGenerator,
  type CannedEntry,
  type GenerationPort,
  type GenerationRequest,
} from './generation';
export {
  ask,
  couldBeDecline,
  isDecline,
  messagesFor,
  HISTORY_TURNS,
  SUGGESTION_COUNT,
  TEMPERATURE,
  type TwinEngineDeps,
} from './orchestrator';
export { validateCitations, type CitationCheck } from './citation-validator';
export { ABSENT_TOKEN, buildSystemPrompt } from './system-prompt';
export { estimateTokens } from './token-estimate';
export {
  browserGpu,
  FALLBACK_MESSAGE,
  probeCapabilities,
  type AdapterLike,
  type Capability,
  type CapabilityReason,
  type GpuLike,
} from './capabilities';
export {
  EMBEDDING_MODEL_ID,
  loadWebLlmEngine,
  MODEL_CHOICES,
  WebLlmEmbedder,
  WebLlmGenerator,
  type LoadProgress,
  type MlcChatChunk,
  type MlcChatRequest,
  type MlcEngineLike,
} from './webllm';
export {
  BundleError,
  parseBundle,
  type BundleChunk,
  type BundleProject,
  type CorpusBundleLike,
} from './bundle';

export { cannedIntro, classifyIntent, type QuestionIntent } from './intent';
export { hasProse } from './orchestrator';
export { uncoveredEntities } from './coverage';
export {
  checkStarters,
  STARTER_QUESTIONS,
  type Starter,
  type StarterProblem,
} from './starters';
