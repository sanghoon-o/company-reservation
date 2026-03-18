import { useState } from 'react'
import { useUser } from './lib/useUser'
import { useDarkMode } from './lib/useDarkMode'
import type { TabType } from './lib/types'
import LoginModal from './components/LoginModal'
import TabBar from './components/TabBar'
import CarPage from './pages/CarPage'
import RoomPage from './pages/RoomPage'
import ChamberPage from './pages/ChamberPage'
import MyPage from './pages/MyPage'

export default function App() {
  const { user, login, logout } = useUser()
  const { dark, toggle } = useDarkMode()
  const [tab, setTab] = useState<TabType>('car')

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
    </div>
  )
}
