import { test, expect } from '@playwright/test';

// Verifies the v0.1.106 / v0.1.107 fix: ChatView must NOT show
// 「会話を表示できません / セッションのエージェント情報が取得できませんでした」
// when the API returns a session whose `agent` is set.
//
// Pre-conditions for the dev server: cchub must have at least one tmux
// session with claude (or codex) running so /api/sessions returns
// agent: 'claude'.

test.use({
  ignoreHTTPSErrors: true,
  baseURL: 'https://localhost:5173',
});

const ERROR_TITLE = '会話を表示できません';
const ERROR_BODY = 'セッションのエージェント情報が取得できませんでした';

async function pickFirstClaudeSession(page: import('@playwright/test').Page) {
  const res = await page.request.get('https://localhost:3456/api/sessions');
  const data = await res.json();
  const target = data.sessions.find((s: { agent?: string; state?: string }) =>
    s.agent === 'claude' && (s.state === 'idle' || s.state === 'working'),
  );
  if (!target) throw new Error('no claude session available — start `claude` in a tmux session');
  return target.id as string;
}

test('ChatView does not show missing-agent error after initial load', async ({ page }) => {
  // Pre-seed openSessions / lastSession with a real claude session so the
  // restore path (fetchAndOpenSession → savedSessionIds) is exercised.
  await page.addInitScript(() => {
    // Stub localStorage *before* React boots.
    // The real ID is injected from the test below via a marker.
  });

  const sessionId = await pickFirstClaudeSession(page);

  // Force chat mode on for this session so ChatView actually mounts.
  // Without this, the bug would never be reachable because the terminal view
  // is shown by default and hides the conversation pane entirely.
  await page.addInitScript(([id]) => {
    localStorage.setItem('cchub-open-sessions', JSON.stringify([id]));
    localStorage.setItem('cchub-last-session-id', id);
    localStorage.setItem('cchub-conversation-mode-sessions', JSON.stringify([id]));
  }, [sessionId]);

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Give the app time to mount, fetch sessions, and resolve activeSession.
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0;
  }, { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Capture state for diagnostics regardless of pass/fail.
  const titleHits = await page.getByText(ERROR_TITLE).count();
  const bodyHits = await page.getByText(ERROR_BODY).count();
  const opened = await page.evaluate(() => localStorage.getItem('cchub-open-sessions'));
  const last = await page.evaluate(() => localStorage.getItem('cchub-last-session-id'));

  console.log(`[diagnostic] open=${opened} last=${last} title=${titleHits} body=${bodyHits} errors=${consoleErrors.length}`);
  if (consoleErrors.length > 0) console.log('[console errors]', consoleErrors.slice(0, 5));

  expect(titleHits, `「${ERROR_TITLE}」が表示されている`).toBe(0);
  expect(bodyHits, `「${ERROR_BODY}」が表示されている`).toBe(0);
});

test('Direct /api/sessions response contains agent for active sessions', async ({ request }) => {
  const res = await request.get('https://localhost:3456/api/sessions');
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  const claudeSession = data.sessions.find(
    (s: { agent?: string }) => s.agent === 'claude',
  );
  expect(claudeSession, 'expected at least one session with agent=claude').toBeTruthy();
});
