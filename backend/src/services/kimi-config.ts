import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reads `~/.kimi-code/config.toml` to learn what a `usage.record` model alias
 * actually bills against.
 *
 * Kimi records the *alias* (`"k3"`), not the provider-side model id, so token
 * counts alone can't be priced. The config maps alias → provider + model:
 *
 *   [providers.openrouter]
 *   base_url = "https://openrouter.ai/api/v1"
 *   api_key  = "sk-or-..."
 *
 *   [models.k3]
 *   provider = "openrouter"
 *   model    = "moonshotai/kimi-k3"
 */

export interface KimiModelBinding {
  /** Alias as it appears in `usage.record.model`. */
  alias: string;
  /** Provider-side model id, e.g. `moonshotai/kimi-k3`. */
  model: string;
  /** Provider key from the config, e.g. `openrouter`. */
  provider?: string;
  /** True when this alias bills through OpenRouter (the only priced path). */
  isOpenRouter: boolean;
}

export interface KimiConfig {
  bindings: Map<string, KimiModelBinding>;
  /** API key of the first OpenRouter provider found, if any. */
  openRouterApiKey?: string;
}

interface RawKimiConfig {
  models?: Record<string, { provider?: unknown; model?: unknown }>;
  providers?: Record<string, { type?: unknown; base_url?: unknown; api_key?: unknown }>;
}

function isOpenRouterProvider(
  name: string,
  provider: { base_url?: unknown } | undefined,
): boolean {
  const baseUrl = typeof provider?.base_url === 'string' ? provider.base_url : '';
  if (baseUrl) return baseUrl.includes('openrouter.ai');
  // No base_url: fall back to the conventional provider name.
  return name.toLowerCase() === 'openrouter';
}

export function parseKimiConfig(toml: string): KimiConfig {
  let raw: RawKimiConfig;
  try {
    raw = Bun.TOML.parse(toml) as RawKimiConfig;
  } catch {
    return { bindings: new Map() };
  }

  const providers = raw.providers ?? {};
  let openRouterApiKey: string | undefined;
  for (const [name, provider] of Object.entries(providers)) {
    if (!isOpenRouterProvider(name, provider)) continue;
    if (typeof provider?.api_key === 'string' && provider.api_key) {
      openRouterApiKey ??= provider.api_key;
    }
  }

  const bindings = new Map<string, KimiModelBinding>();
  for (const [alias, model] of Object.entries(raw.models ?? {})) {
    if (typeof model?.model !== 'string' || !model.model) continue;
    const provider = typeof model.provider === 'string' ? model.provider : undefined;
    bindings.set(alias, {
      alias,
      model: model.model,
      provider,
      isOpenRouter: provider ? isOpenRouterProvider(provider, providers[provider]) : false,
    });
  }
  return { bindings, openRouterApiKey };
}

/** Reads and parses the Kimi config, caching briefly so a dashboard poll
 *  doesn't re-read it per request. Missing/unreadable config = no bindings. */
export class KimiConfigService {
  private cache: { timestamp: number; config: KimiConfig } | null = null;
  private static readonly CACHE_TTL = 60_000;

  constructor(private readonly configPath = join(homedir(), '.kimi-code', 'config.toml')) {}

  async getConfig(): Promise<KimiConfig> {
    if (this.cache && Date.now() - this.cache.timestamp < KimiConfigService.CACHE_TTL) {
      return this.cache.config;
    }
    let config: KimiConfig;
    try {
      config = parseKimiConfig(await readFile(this.configPath, 'utf8'));
    } catch {
      config = { bindings: new Map() };
    }
    this.cache = { timestamp: Date.now(), config };
    return config;
  }

  /** OpenRouter key from the Kimi config, for reading that account's spend. */
  async getOpenRouterApiKey(): Promise<string | null> {
    return (await this.getConfig()).openRouterApiKey ?? null;
  }
}
