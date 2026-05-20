import { useState, useEffect } from 'react'
import { useUser } from './lib/useUser'
import { useDarkMode } from './lib/useDarkMode'
import { toLocalDateStr } from './lib/date'
import type { TabType } from './lib/types'
import LoginModal from './components/LoginModal'
import TabBar from './components/TabBar'
import CarPage from './pages/CarPage'
import RoomPage from './pages/RoomPage'
import ChamberPage from './pages/ChamberPage'
import InstrumentPage from './pages/InstrumentPage'
import MyPage from './pages/MyPage'

// 공지 노출 기간: 2026-05-20 ~ 2026-05-26 (7일간), 하루 한 번만 노출
const NOTICE_START = '2026-05-20'
const NOTICE_END = '2026-05-26'
const NOTICE_LAST_SHOWN_KEY = 'notice_last_shown_v3'

export default function App() {
  const { user, login, logout } = useUser()
  const { dark, toggle } = useDarkMode()
  const [tab, setTab] = useState<TabType>('car')
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => {
    const today = toLocalDateStr()
    if (today < NOTICE_START || today > NOTICE_END) return
    if (localStorage.getItem(NOTICE_LAST_SHOWN_KEY) === today) return
    setShowNotice(true)
  }, [])

  const dismissNotice = () => {
    setShowNotice(false)
    localStorage.setItem(NOTICE_LAST_SHOWN_KEY, toLocalDateStr())
  }

  if (!user) {
    return <LoginModal onLogin={login} />
  }

  return (
    <div className="flex h-full flex-col bg-(--color-bg)">
      <div className="flex-1 overflow-hidden">
        {tab === 'car' && <CarPage user={user} />}
        {tab === 'room' && <RoomPage user={user} />}
        {tab === 'chamber' && <ChamberPage user={user} />}
        {tab === 'instrument' && <InstrumentPage user={user} />}
        {tab === 'my' && <MyPage user={user} onLogout={logout} dark={dark} onToggleDark={toggle} />}
      </div>
      <TabBar active={tab} onChange={setTab} />

      {/* 공지 팝업 */}
      {showNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={dismissNotice}>
          <div
            className="w-full max-w-sm rounded-2xl bg-(--color-surface) p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📢</span>
              <h3 className="text-lg font-bold text-(--color-text)">공지사항</h3>
            </div>
            <div className="space-y-3 text-sm text-(--color-text) leading-relaxed">
              <p>
                <strong className="text-(--color-primary)">계측기 관리</strong> 메뉴가 새로 추가됐습니다.
                계측기 사용 시작 시 <strong>'사용'</strong>을 눌러주시면 관리대장에 자동 기록됩니다.
              </p>
              <p className="text-(--color-text-secondary)">
                ※ 화면이 새 메뉴(계측기)가 안 보이면 아래 절차로 한 번만 갱신해 주세요. 이후엔 자동 갱신됩니다.
              </p>
              <div className="rounded-lg bg-(--color-bg) p-3 space-y-1.5 text-xs text-(--color-text-secondary)">
                <p>• <strong className="text-(--color-text)">PC 브라우저</strong>: Ctrl + Shift + R</p>
                <p>• <strong className="text-(--color-text)">모바일 PWA</strong>: 홈화면 아이콘 길게 → 앱 정보 → 저장공간 → 저장공간 지우기 → 다시 열기</p>
              </div>
            </div>
            <button
              onClick={dismissNotice}
              className="w-full mt-5 rounded-lg bg-(--color-primary) py-3 text-sm font-semibold text-white"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
