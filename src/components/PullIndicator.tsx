import { RefreshCw } from 'lucide-react'

interface Props {
  pullY: number
  refreshing: boolean
}

export default function PullIndicator({ pullY, refreshing }: Props) {
  if (pullY === 0 && !refreshing) return null
  return (
    <div
      className="flex items-center justify-center overflow-hidden"
      style={{ height: refreshing ? 36 : pullY, transition: pullY === 0 ? 'height 0.2s' : 'none' }}
    >
      <RefreshCw
        size={16}
        className={`text-(--color-primary) ${refreshing ? 'animate-spin' : ''}`}
        style={!refreshing ? { transform: `rotate(${pullY * 4}deg)` } : undefined}
      />
      <span className="ml-2 text-xs text-(--color-text-secondary)">
        {refreshing ? '새로고침 중...' : pullY > 50 ? '놓으면 새로고침' : '당겨서 새로고침'}
      </span>
    </div>
  )
}
