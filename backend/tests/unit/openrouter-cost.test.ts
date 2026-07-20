import { describe, expect, test } from 'bun:test';
import { parseKimiConfig } from '../../src/services/kimi-config';
import { costOf, OpenRouterPricingService } from '../../src/services/openrouter';

const CONFIG = `
default_model = "k3"

[providers.openrouter]
type = "openai"
base_url = "https://openrouter.ai/api/v1"
api_key = "sk-or-v1-test"

[providers.moonshot]
type = "openai"
base_url = "https://api.moonshot.ai/v1"
api_key = "sk-moonshot"

[models.k3]
provider = "openrouter"
model = "moonshotai/kimi-k3"

[models.direct]
provider = "moonshot"
model = "kimi-k2"
`;

describe('parseKimiConfig', () => {
  test('maps an alias to its provider-side model id', () => {
    const { bindings } = parseKimiConfig(CONFIG);
    expect(bindings.get('k3')).toEqual({
      alias: 'k3',
      model: 'moonshotai/kimi-k3',
      provider: 'openrouter',
      isOpenRouter: true,
    });
  });

  test('a non-OpenRouter provider is not marked priceable', () => {
    // Pricing comes from OpenRouter's list; a direct Moonshot key bills
    // differently, so it must not borrow those numbers.
    expect(parseKimiConfig(CONFIG).bindings.get('direct')?.isOpenRouter).toBe(false);
  });

  test('picks up the OpenRouter api key', () => {
    expect(parseKimiConfig(CONFIG).openRouterApiKey).toBe('sk-or-v1-test');
  });

  test('a provider named openrouter without base_url still counts', () => {
    const { bindings } = parseKimiConfig(`
[providers.openrouter]
api_key = "sk-or-v1-x"
[models.a]
provider = "openrouter"
model = "moonshotai/kimi-k3"
`);
    expect(bindings.get('a')?.isOpenRouter).toBe(true);
  });

  test('malformed TOML yields no bindings instead of throwing', () => {
    expect(parseKimiConfig('this is not = = toml [[[').bindings.size).toBe(0);
  });

  test('a model entry without a model id is skipped', () => {
    expect(parseKimiConfig('[models.a]\nprovider = "openrouter"\n').bindings.size).toBe(0);
  });
});

describe('costOf', () => {
  const pricing = {
    prompt: 0.000003,
    completion: 0.000015,
    cacheRead: 0.0000003,
    cacheWrite: undefined,
  };

  test('prices each token kind at its own rate', () => {
    const usd = costOf(
      { inputOther: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, output: 1_000_000 },
      pricing,
    );
    // 3 + 0.30 + 15
    expect(usd).toBeCloseTo(18.3, 6);
  });

  test('cache writes fall back to the prompt price when unpriced', () => {
    const usd = costOf(
      { inputOther: 0, cacheRead: 0, cacheWrite: 1_000_000, output: 0 },
      pricing,
    );
    expect(usd).toBeCloseTo(3, 6);
  });

  test('cache reads fall back to the prompt price when the model has no cache discount', () => {
    const usd = costOf(
      { inputOther: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 },
      { prompt: 0.000003, completion: 0.000015 },
    );
    expect(usd).toBeCloseTo(3, 6);
  });

  test('zero tokens cost nothing', () => {
    expect(costOf({ inputOther: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, pricing)).toBe(0);
  });
});

describe('OpenRouterPricingService', () => {
  function serviceReturning(body: unknown): OpenRouterPricingService {
    const url = `data:application/json,${encodeURIComponent(JSON.stringify(body))}`;
    return new OpenRouterPricingService(url);
  }

  test('parses string prices from the model list', async () => {
    const service = serviceReturning({
      data: [
        {
          id: 'moonshotai/kimi-k3',
          pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003' },
        },
      ],
    });
    expect(await service.getPricing('moonshotai/kimi-k3')).toEqual({
      prompt: 0.000003,
      completion: 0.000015,
      cacheRead: 0.0000003,
      cacheWrite: undefined,
    });
  });

  test('unknown model has no price (so callers report no cost)', async () => {
    const service = serviceReturning({ data: [] });
    expect(await service.getPricing('moonshotai/kimi-k3')).toBeUndefined();
  });

  test('a model missing base prices is skipped rather than half-priced', async () => {
    const service = serviceReturning({
      data: [{ id: 'weird/model', pricing: { completion: '0.000015' } }],
    });
    expect(await service.getPricing('weird/model')).toBeUndefined();
  });

  test('an unreachable price list yields no price instead of throwing', async () => {
    const service = new OpenRouterPricingService('http://127.0.0.1:1/models');
    expect(await service.getPricing('moonshotai/kimi-k3')).toBeUndefined();
  });
});
