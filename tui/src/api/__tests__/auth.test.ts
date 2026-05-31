import { describe, expect, test } from 'bun:test';
import { resolveToken } from '../auth';

function requiredResponse(required: boolean): Response {
  return new Response(JSON.stringify({ required }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveToken', () => {
  test('認証不要なら null を返し、トークン発行はしない', async () => {
    let signed = false;
    const token = await resolveToken('http://h:5923', {
      fetchImpl: async () => requiredResponse(false),
      readSecret: async () => 'secret',
      signToken: async () => {
        signed = true;
        return 'tkn';
      },
    });
    expect(token).toBeNull();
    expect(signed).toBe(false);
  });

  test('認証必須なら jwt-secret からトークンを発行', async () => {
    const captured: { secret?: string; username?: string } = {};
    const token = await resolveToken('http://h:5923', {
      fetchImpl: async () => requiredResponse(true),
      readSecret: async (dataDir) => {
        expect(dataDir).toBe('/tmp/data');
        return 'the-secret';
      },
      signToken: async (secret, username) => {
        captured.secret = secret;
        captured.username = username;
        return 'minted-token';
      },
      dataDir: '/tmp/data',
    });
    expect(token).toBe('minted-token');
    expect(captured.secret).toBe('the-secret');
    expect(captured.username).toBe('cchub-tui');
  });

  test('サーバ未接続なら分かりやすいエラー', async () => {
    await expect(
      resolveToken('http://h:5923', {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).rejects.toThrow('サーバに接続できません');
  });

  test('認証必須だが secret を読めない場合は案内付きエラー', async () => {
    await expect(
      resolveToken('http://h:5923', {
        fetchImpl: async () => requiredResponse(true),
        readSecret: async () => {
          throw new Error('ENOENT');
        },
      }),
    ).rejects.toThrow('ローカルトークンを発行できません');
  });
});
