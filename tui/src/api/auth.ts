// ゼロコンフィグ認証の解決。
// - サーバが認証不要なら null（トークン不要）。
// - 認証必須なら、同一ホスト・同一ユーザの利点を使い、データディレクトリの
//   jwt-secret を読んでサーバと同一署名のローカルトークンを自己発行する。
//
// 署名はサーバの検証と一致させる必要があるため、backend の AuthService を再利用する
// （型のみ/軽量。重複実装は避ける = 憲章 原則II）。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthService } from '../../../backend/src/services/auth';
import { getDataDir } from '../../../backend/src/utils/storage';
import type { FetchLike } from './client';

export interface ResolveAuthDeps {
  fetchImpl?: FetchLike;
  /** dataDir から jwt-secret を読む（テスト注入用） */
  readSecret?: (dataDir: string) => Promise<string>;
  /** secret と username からトークンを発行（テスト注入用） */
  signToken?: (secret: string, username: string) => Promise<string>;
  /** データディレクトリ（既定 getDataDir()） */
  dataDir?: string;
}

const TUI_USERNAME = 'cchub-tui';

async function defaultReadSecret(dataDir: string): Promise<string> {
  const secret = (await readFile(join(dataDir, 'jwt-secret'), 'utf-8')).trim();
  if (!secret) throw new Error('jwt-secret が空です');
  return secret;
}

async function defaultSignToken(secret: string, username: string): Promise<string> {
  const service = new AuthService(getDataDir(), secret);
  return service.generateTokenForUser(username);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * サーバが認証必須かを `/api/auth/required` で判定し、必要ならローカルトークンを発行する。
 * @returns Bearer トークン、または不要なら null
 * @throws サーバ未接続、または認証必須なのに jwt-secret を読めない場合
 */
export async function resolveToken(baseUrl: string, deps: ResolveAuthDeps = {}): Promise<string | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  const readSecret = deps.readSecret ?? defaultReadSecret;
  const signToken = deps.signToken ?? defaultSignToken;
  const dataDir = deps.dataDir ?? getDataDir();

  let required = false;
  try {
    const res = await doFetch(`${stripTrailingSlash(baseUrl)}/api/auth/required`);
    if (res.ok) {
      const body = (await res.json()) as { required?: boolean };
      required = Boolean(body.required);
    }
  } catch (e) {
    throw new Error(`サーバに接続できません: ${(e as Error).message}`);
  }

  if (!required) return null;

  try {
    const secret = await readSecret(dataDir);
    return await signToken(secret, TUI_USERNAME);
  } catch (e) {
    throw new Error(
      `認証が必要ですが、ローカルトークンを発行できません（${join(dataDir, 'jwt-secret')} を読めません）: ${(e as Error).message}`,
    );
  }
}
