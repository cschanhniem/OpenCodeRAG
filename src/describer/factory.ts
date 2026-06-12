import type { DescriptionProvider } from "../core/interfaces.js";
import type { DescriptionConfig } from "../core/config.js";
import { LLMDescriptionProvider } from "./describer.js";
import { AnthropicDescriptionProvider } from "./anthropic.js";
import { GeminiDescriptionProvider } from "./gemini.js";

export function createDescriptionProvider(
  config: DescriptionConfig
): DescriptionProvider {
  if (config.provider === "anthropic") {
    if (!config.apiKey) {
      throw new Error("Anthropic provider requires an apiKey");
    }
    return new AnthropicDescriptionProvider(config);
  }

  if (config.provider === "google") {
    if (!config.apiKey) {
      throw new Error("Google Gemini provider requires an apiKey");
    }
    return new GeminiDescriptionProvider(config);
  }

  return new LLMDescriptionProvider(config);
}
