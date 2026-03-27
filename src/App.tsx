import { useState, useEffect } from 'react'
import { useUser } from './lib/useUser'
import { useDarkMode } from './lib/useDarkMode'
import type { TabType } from './lib/types'
import LoginModal from './components/LoginModal'
import TabBar from './components/TabBar'
import CarPage from './pages/CarPage'
import RoomPage from './pages/RoomPage'
import ChamberPage from './pages/ChamberPage'
import MyPage from './pages/MyPage'

const NOTICE_KEY = 'notice_dismissed_v1'

export default function App() {
  const { user, login, logout } = useUser()
  const { dark, toggle } = useDarkMode()
  const [tab, setTab] = useState<TabType>('car')
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(NOTICE_KEY)) setShowNotice(true)
  }, [])

  const dismissNotice = () => {
    setShowNotice(false)
    localStorage.setItem(NOTICE_KEY, 'true')
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
                주행 후 <strong className="text-(--color-primary)">'예약정보'</strong>를 클릭하면
                <strong className="text-(--color-primary)"> '차량 일지'</strong> 작성을 바로 할 수 있습니다.
              </p>
              <p className="text-(--color-text-secondary)">
                2026년 3월 30일 이전은 기존 장부를 이용하시면 됩니다.
              </p>
              <p>
                이후부터 <strong>에델예약</strong> 앱에서 차량 일지 작성하시면 됩니다.
              </p>
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
