import { Car, DoorOpen, Box, CalendarCheck } from 'lucide-react'
import type { TabType } from '../lib/types'

const tabs: { key: TabType; label: string; icon: typeof Car }[] = [
  { key: 'car', label: '차량', icon: Car },
  { key: 'room', label: '미팅룸', icon: DoorOpen },
  { key: 'chamber', label: '챔버', icon: Box },
  { key: 'my', label: '내예약', icon: CalendarCheck },
]

interface Props {
  active: TabType
  onChange: (tab: TabType) => void
}

export default function TabBar({ active, onChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-(--color-border) bg-(--color-surface) safe-bottom">
      <div className="mx-auto flex max-w-lg">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 pt-3 text-xs transition-colors ${
              active === key
                ? 'text-(--color-primary-light) font-semibold'
                : 'text-(--color-text-secondary)'
            }`}
          >
            <Icon size={22} strokeWidth={active === key ? 2.5 : 1.8} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
