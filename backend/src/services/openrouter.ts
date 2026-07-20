import type { OpenRouterAccountUsage } from '../../../shared/types';

/**
 * OpenRouter integration for cost reporting.
 *
 * Two independent sources, deliberately kept apart:
 * - **Pricing** (`OpenRouterPricingService`) comes from the public model list
 *   (no auth) and is only used to *estimate* the cost of locally recorded
 *   tokens. Unknown model → no price → the caller reports no cost rather than
 *   a wrong one.
 * - **Account spend** (`OpenRouterAccountService`) is OpenRouter's own
 *   accounting for the configured API key. Authoritative, and the only figure
 *   that includes OpenRouter's fees, so it is labelled "actual" in the UI.
 */

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/key';
const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const REQUEST_TIMEOUT_MS = 10_000;

/** USD per token, by token kind. */
export interface ModelPricing {
  prompt: number;
  completion: number;
  /** Cached-input read price; absent when the model doesn't discount cache reads. */
  cacheRead?: number;
  /** Cache-write price; absent when the model doesn't charge one. */
  cacheWrite?: number;
}

export interface TokenCounts {
  /** Uncached input tokens. */
  inputOther: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** USD cost of `tokens` at `pricing`. Cache tokens fall back to the prompt
 *  price when the model doesn't publish a separate one — that is how
 *  OpenRouter bills them. */
export function costOf(tokens: TokenCounts, pricing: ModelPricing): number {
  return (
    tokens.inputOther * pricing.prompt +
    tokens.cacheRead * (pricing.cacheRead ?? pricing.prompt) +
    tokens.cacheWrite * (pricing.cacheWrite ?? pricing.prompt) +
    tokens.output * pricing.completion
  );
}

function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Public per-model pricing, cached for a day (list prices rarely move). */
export class OpenRouterPricingService {
  private cache: { timestamp: number; prices: Map<string, ModelPricing> } | null = null;
  private inflight: Promise<Map<string, ModelPricing>> | null = null;
  private static readonly CACHE_TTL = 24 * 60 * 60 * 1000;
  /** Retry sooner when the fetch produced nothing (offline / API down). */
  private static readonly EMPTY_RETRY_TTL = 5 * 60 * 1000;

  constructor(private readonly modelsUrl = MODELS_URL) {}

  async getPricing(modelId: string): Promise<ModelPricing | undefined> {
    return (await this.getPrices()).get(modelId);
  }

  private async getPrices(): Promise<Map<string, ModelPricing>> {
    const ttl = this.cache?.prices.size
      ? OpenRouterPricingService.CACHE_TTL
      : OpenRouterPricingService.EMPTY_RETRY_TTL;
    if (this.cache && Date.now() - this.cache.timestamp < ttl) return this.cache.prices;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchPrices();
    try {
      const prices = await this.inflight;
      this.cache = { timestamp: Date.now(), prices };
      return prices;
    } finally {
      this.inflight = null;
    }
  }

  private async fetchPrices(): Promise<Map<string, ModelPricing>> {
    const body = await fetchJson(this.modelsUrl);
    const prices = new Map<string, ModelPricing>();
    const models = (body as { data?: unknown })?.data;
    if (!Array.isArray(models)) return prices;
    for (const entry of models) {
      const model = entry as { id?: unknown; pricing?: Record<string, unknown> };
      if (typeof model.id !== 'string' || !model.pricing) continue;
      const prompt = positiveNumber(model.pricing.prompt);
      const completion = positiveNumber(model.pricing.completion);
      // A model without both base prices can't be costed at all.
      if (prompt === undefined || completion === undefined) continue;
      prices.set(model.id, {
        prompt,
        completion,
        cacheRead: positiveNumber(model.pricing.input_cache_read),
        cacheWrite: positiveNumber(model.pricing.input_cache_write),
      });
    }
    return prices;
  }
}

/**
 * Actual spend for the configured API key. `/api/v1/key` reports that key's
 * own calendar-window spend; `/api/v1/credits` reports account-wide purchases
 * and usage, which is where the remaining balance comes from.
 */
export class OpenRouterAccountService {
  private cache: { timestamp: number; data: OpenRouterAccountUsage | null } | null = null;
  private inflight: Promise<OpenRouterAccountUsage | null> | null = null;
  private static readonly CACHE_TTL = 60_000;
  /** Back off harder after a failure so a revoked key can't be retried per poll. */
  private static readonly FAILURE_TTL = 5 * 60 * 1000;

  constructor(private readonly resolveApiKey: () => Promise<string | null>) {}

  async getUsage(): Promise<OpenRouterAccountUsage | null> {
    const ttl = this.cache?.data
      ? OpenRouterAccountService.CACHE_TTL
      : OpenRouterAccountService.FAILURE_TTL;
    if (this.cache && Date.now() - this.cache.timestamp < ttl) return this.cache.data;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchUsage();
    try {
      const data = await this.inflight;
      this.cache = { timestamp: Date.now(), data };
      return data;
    } finally {
      this.inflight = null;
    }
  }

  private async fetchUsage(): Promise<OpenRouterAccountUsage | null> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) return null;
    const headers = { Authorization: `Bearer ${apiKey}` };
    const [keyBody, creditsBody] = await Promise.all([
      fetchJson(KEY_URL, { headers }),
      fetchJson(CREDITS_URL, { headers }),
    ]);

    const key = (keyBody as { data?: Record<string, unknown> })?.data;
    const credits = (creditsBody as { data?: Record<string, unknown> })?.data;
    // Both calls failing means the key is bad or OpenRouter is unreachable —
    // report nothing rather than a card full of zeroes.
    if (!key && !credits) return null;

    const purchased = positiveNumber(credits?.total_credits);
    const used = positiveNumber(credits?.total_usage);
    return {
      usageDailyUsd: positiveNumber(key?.usage_daily),
      usageWeeklyUsd: positiveNumber(key?.usage_weekly),
      usageMonthlyUsd: positiveNumber(key?.usage_monthly),
      usageTotalUsd: positiveNumber(key?.usage),
      creditsPurchasedUsd: purchased,
      creditsUsedUsd: used,
      creditsRemainingUsd:
        purchased !== undefined && used !== undefined ? purchased - used : undefined,
      // `limit` is null when the key has no cap; keep that distinct from "unknown".
      limitUsd: key && 'limit' in key ? (positiveNumber(key.limit) ?? null) : undefined,
      limitRemainingUsd:
        key && 'limit_remaining' in key ? (positiveNumber(key.limit_remaining) ?? null) : undefined,
      fetchedAt: new Date().toISOString(),
    };
  }
}
