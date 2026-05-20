import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// === 일회성 SW 강제 갱신 (2026-05-20) ===
// 옛 SW(v13 이하)가 cross-origin JSONP/iframe을 가로채 시트 업데이트가 안 되던 환경 대응.
// localStorage 플래그로 한 번만 실행. 새 사용자에겐 무해 (SW 없으면 즉시 빠져나감).
const SW_FORCE_REFRESH_KEY = 'sw_force_refreshed_v16'
if ('serviceWorker' in navigator && !localStorage.getItem(SW_FORCE_REFRESH_KEY)) {
  navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (regs.length === 0) {
      localStorage.setItem(SW_FORCE_REFRESH_KEY, '1')
      return
    }
    localStorage.setItem(SW_FORCE_REFRESH_KEY, '1')
    await Promise.all(regs.map((r) => r.unregister()))
    // 캐시도 비우기 (선택적)
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    }
    window.location.reload()
  }).catch(() => { /* noop */ })
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 새 SW가 install되어 waiting 상태가 되면 자동 activate + 페이지 reload
      const triggerReloadIfWaiting = () => {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }
      reg.addEventListener('updatefound', () => {
        const newSw = reg.installing
        if (!newSw) return
        newSw.addEventListener('statechange', () => {
          if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
            // 새 SW가 설치 완료되었고 기존 SW가 제어 중 → skipWaiting 트리거
            triggerReloadIfWaiting()
          }
        })
      })
      // 페이지 다시 활성화될 때 SW 업데이트 체크
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().catch(() => { /* noop */ })
        }
      })
      triggerReloadIfWaiting()
    }).catch(() => { /* noop */ })

    // 새 SW가 controller로 활성화되면 페이지 자동 리로드 (한 번만)
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
