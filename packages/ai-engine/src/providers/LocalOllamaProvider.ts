import { OpenAIProvider } from './OpenAIProvider.js';
import type { AIProviderConfig } from '../types.js';

export class LocalOllamaProvider extends OpenAIProvider {
  public override readonly id = 'ollama';
  public override readonly name = 'Local Ollama (Offline)';

  constructor(config: AIProviderConfig = {}) {
    super({
      apiKey: config.apiKey || 'ollama',
      baseUrl: config.baseUrl || 'http://localhost:11434/v1',
      modelName: config.modelName || 'llama3.1:8b'
    });
  }

  /**
   * Health check to confirm local Ollama daemon is reachable
   */
  public async checkHealth(): Promise<{ isHealthy: boolean; availableModels: string[] }> {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) {
        return { isHealthy: false, availableModels: [] };
      }
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      return { isHealthy: true, availableModels: models };
    } catch {
      return { isHealthy: false, availableModels: [] };
    }
  }
}
