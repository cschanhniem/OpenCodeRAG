export interface ProviderDefaults {
  defaultBaseUrl: string;
  apiKeyEnvVar: string;
  supportsEmbedding: boolean;
  supportsChat: boolean;
}

export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  ollama: {
    defaultBaseUrl: "http://127.0.0.1:11434",
    apiKeyEnvVar: "",
    supportsEmbedding: true,
    supportsChat: true,
  },
  openai: {
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    supportsEmbedding: true,
    supportsChat: true,
  },
  nvidia: {
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnvVar: "NVIDIA_API_KEY",
    supportsEmbedding: true,
    supportsChat: true,
  },
  azure: {
    defaultBaseUrl: "",
    apiKeyEnvVar: "AZURE_OPENAI_KEY",
    supportsEmbedding: true,
    supportsChat: true,
  },
  mistral: {
    defaultBaseUrl: "https://api.mistral.ai/v1",
    apiKeyEnvVar: "MISTRAL_API_KEY",
    supportsEmbedding: true,
    supportsChat: true,
  },
  together: {
    defaultBaseUrl: "https://api.together.xyz/v1",
    apiKeyEnvVar: "TOGETHER_API_KEY",
    supportsEmbedding: true,
    supportsChat: true,
  },
  groq: {
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnvVar: "GROQ_API_KEY",
    supportsEmbedding: false,
    supportsChat: true,
  },
  deepseek: {
    defaultBaseUrl: "https://api.deepseek.com",
    apiKeyEnvVar: "DEEPSEEK_API_KEY",
    supportsEmbedding: false,
    supportsChat: true,
  },
  fireworks: {
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyEnvVar: "FIREWORKS_API_KEY",
    supportsEmbedding: true,
    supportsChat: true,
  },
  anthropic: {
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    supportsEmbedding: false,
    supportsChat: true,
  },
  google: {
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1",
    apiKeyEnvVar: "GOOGLE_API_KEY",
    supportsEmbedding: false,
    supportsChat: true,
  },
  cohere: {
    defaultBaseUrl: "https://api.cohere.ai/v1",
    apiKeyEnvVar: "COHERE_API_KEY",
    supportsEmbedding: true,
    supportsChat: false,
  },
};

export function getProviderDefault(provider: string): ProviderDefaults | undefined {
  return PROVIDER_DEFAULTS[provider];
}

export function isOpenAiCompatible(provider: string): boolean {
  if (provider === "ollama" || provider === "anthropic" || provider === "google" || provider === "cohere") {
    return false;
  }
  return true;
}
