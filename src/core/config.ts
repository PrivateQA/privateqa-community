export type FwkTestConfig = {
  ollamaBaseUrl: string;
  embeddingModel: string;
  generationModel: string;
  mapPath: string;
  generatedTestsDir: string;
};

export const defaultConfig: FwkTestConfig = {
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  embeddingModel: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  generationModel: process.env.OLLAMA_GEN_MODEL ?? "mistral",
  mapPath: ".fwkTest/map.json",
  generatedTestsDir: "tests/generated",
};

