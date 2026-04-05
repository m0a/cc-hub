// Phone settings UI — shown when launched from Even Hub app (appMenu)

import type { Bridge } from './display.ts'
import { setBaseUrl, getDashboard, getSessions } from './api.ts'

const LS_KEY = 'cchub-url'

export async function startPhoneUI(bridge: Bridge | null): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app')!

  // Load saved URL
  let savedUrl = ''
  if (bridge) {
    savedUrl = await bridge.getLocalStorage(LS_KEY) || ''
  }

  app.innerHTML = `
    <div style="font-family: -apple-system, sans-serif; background: #111; color: #eee; min-height: 100vh; padding: 20px;">
      <h1 style="font-size: 22px; margin-bottom: 4px;">CC Hub Glasses</h1>
      <p style="color: #888; font-size: 13px; margin-bottom: 24px;">Claude Codeセッションをスマートグラスから管理</p>

      <div id="setup-section" style="display: none;">
        <div style="background: #1a1a2e; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <h2 style="font-size: 16px; color: #0f0; margin-bottom: 12px;">セットアップ</h2>
          <p style="font-size: 13px; color: #aaa; line-height: 1.6; margin-bottom: 12px;">
            CC Hubは、Claude Codeセッションをリモート管理するツールです。
            PCにCC Hubをインストールし、Tailscaleで接続してください。
          </p>
          <ol style="font-size: 13px; color: #ccc; line-height: 1.8; padding-left: 20px; margin-bottom: 12px;">
            <li>PCにCC Hubをインストール<br>
              <code style="background: #222; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #0f0;">curl -fsSL https://raw.githubusercontent.com/m0a/cc-hub/main/install.sh | bash</code>
            </li>
            <li>CC Hubを起動: <code style="background: #222; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #0f0;">cchub</code></li>
            <li>スマホにTailscaleをインストールして同じネットワークに接続</li>
            <li>下のURLを入力して接続</li>
          </ol>
        </div>
      </div>

      <div style="background: #1a1a2e; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        <h2 style="font-size: 16px; color: #0f0; margin-bottom: 12px;">CC Hub接続</h2>
        <input id="url-input" type="url" value="${savedUrl}"
          placeholder="https://hostname.tail*****.ts.net:5923"
          style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #222; color: #eee; font-size: 14px; margin-bottom: 8px; box-sizing: border-box;"
        />
        <div style="display: flex; gap: 8px;">
          <button id="btn-connect" style="flex: 1; padding: 10px; border-radius: 8px; border: none; background: #0a0; color: #fff; font-size: 14px; cursor: pointer;">
            接続
          </button>
          <button id="btn-disconnect" style="padding: 10px 16px; border-radius: 8px; border: 1px solid #444; background: transparent; color: #888; font-size: 14px; cursor: pointer; display: none;">
            切断
          </button>
        </div>
        <div id="connect-status" style="margin-top: 8px; font-size: 13px;"></div>
      </div>

      <div id="connected-info" style="display: none; background: #1a1a2e; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
        <h2 style="font-size: 16px; color: #0f0; margin-bottom: 12px;">接続中</h2>
        <div id="server-info" style="font-size: 13px; color: #ccc; line-height: 1.8;"></div>
        <p style="margin-top: 12px; font-size: 14px; color: #0f0;">
          ✓ メガネから操作できます
        </p>
      </div>
    </div>
  `

  const urlInput = document.getElementById('url-input') as HTMLInputElement
  const btnConnect = document.getElementById('btn-connect')!
  const btnDisconnect = document.getElementById('btn-disconnect')!
  const connectStatus = document.getElementById('connect-status')!
  const connectedInfo = document.getElementById('connected-info')!
  const setupSection = document.getElementById('setup-section')!
  const serverInfo = document.getElementById('server-info')!

  // Show setup instructions if no saved URL
  if (!savedUrl) {
    setupSection.style.display = 'block'
  }

  // If already saved, auto-connect
  if (savedUrl) {
    await tryConnect(savedUrl)
  }

  btnConnect.addEventListener('click', async () => {
    const url = urlInput.value.trim().replace(/\/+$/, '')
    if (!url) {
      connectStatus.innerHTML = '<span style="color: #f44;">URLを入力してください</span>'
      return
    }
    await tryConnect(url)
  })

  btnDisconnect.addEventListener('click', async () => {
    if (bridge) {
      await bridge.setLocalStorage(LS_KEY, '')
    }
    connectedInfo.style.display = 'none'
    btnDisconnect.style.display = 'none'
    setupSection.style.display = 'block'
    connectStatus.innerHTML = '<span style="color: #888;">切断しました</span>'
  })

  async function tryConnect(url: string) {
    connectStatus.innerHTML = '<span style="color: #ff0;">接続中...</span>'
    try {
      setBaseUrl(url)
      const [dashRes, sessionsRes] = await Promise.all([
        getDashboard(),
        getSessions(),
      ])

      // Save URL
      if (bridge) {
        await bridge.setLocalStorage(LS_KEY, url)
      }
      urlInput.value = url

      // Show connected info
      const version = dashRes.version || '?'
      const sessionCount = sessionsRes.sessions?.length || 0
      const usage = dashRes.usageLimits
        ? `${dashRes.usageLimits.fiveHour.utilization}%`
        : 'N/A'

      serverInfo.innerHTML = `
        サーバー: ${url}<br>
        バージョン: v${version}<br>
        セッション数: ${sessionCount}<br>
        API使用率: ${usage}
      `

      connectStatus.innerHTML = `<span style="color: #0f0;">✓ 接続成功</span>`
      connectedInfo.style.display = 'block'
      btnDisconnect.style.display = 'block'
      setupSection.style.display = 'none'
    } catch (e) {
      connectStatus.innerHTML = `<span style="color: #f44;">接続失敗: ${(e as Error).message}</span>`
      connectedInfo.style.display = 'none'
    }
  }
}
