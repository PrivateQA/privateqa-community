export type OllamaEmbeddingsResponse = {
  embedding: number[];
};

export type OllamaGenerateResponse = {
  response: string;
};

export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async embeddings(model: string, input: string): Promise<number[]> {
    // Ollama has had slightly different endpoints over time.
    // Try the most common one, then fallback.
    const payload = { model, prompt: input };

    const tryPost = async (path: string) => {
      const res = await fetch(new URL(path, this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama embeddings failed (${res.status}) ${text}`);
      }
      const json = (await res.json()) as OllamaEmbeddingsResponse;
      if (!Array.isArray(json.embedding)) {
        throw new Error("Ollama embeddings: réponse invalide (embedding manquant).");
      }
      return json.embedding;
    };

    try {
      return await tryPost("/api/embeddings");
    } catch {
      // Fallback for older/newer variants
      return await tryPost("/api/embed");
    }
  }

  async generate(model: string, prompt: string): Promise<string> {
    const res = await fetch(new URL("/api/generate", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama generate failed (${res.status}) ${text}`);
    }
    const json = (await res.json()) as OllamaGenerateResponse;
    return json.response ?? "";
  }
}

