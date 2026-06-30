/**
 * @fileoverview Factory for creating description providers (Anthropic, Gemini, or OpenAI-compatible).
 */
import type { DescriptionProvider } from "../core/interfaces.js";
import type { DescriptionConfig } from "../core/config.js";
import { LlmDescriptionProvider } from "./describer.js";
import { AnthropicDescriptionProvider } from "./anthropic.js";
import { GeminiDescriptionProvider } from "./gemini.js";

/**
 * Create a description provider instance based on configuration.
 *
 * Dispatches to AnthropicDescriptionProvider, GeminiDescriptionProvider, or the generic
 * LlmDescriptionProvider depending on the provider field in config.
 *
 * @param config - Description configuration including provider type, API keys, and model settings
 * @returns An initialized DescriptionProvider instance
 * @throws If the provider requires an apiKey that is not set
 */
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

  return new LlmDescriptionProvider(config);
}
