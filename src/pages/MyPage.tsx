import { useState, useEffect, useCallback, useRef } from 'react'
import { Car, DoorOpen, Box, LogOut, Moon, Sun } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { CarReservation, RoomReservation, User } from '../lib/types'
import Modal from '../components/Modal'
import { toLocalDateStr } from '../lib/date'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullIndicator from '../components/PullIndicator'

interface Props {
  user: User
  onLogout: () => void
  dark: boolean
  onToggleDark: () => void
}

type AnyReservation = (CarReservation & { _type: 'car' }) | (RoomReservation & { _type: 'room' })

export default function MyPage({ user, onLogout, dark, onToggleDark }: Props) {
  const [items, setItems] = useState<AnyReservation[]>([])
  const [cancelTarget, setCancelTarget] = useState<AnyReservation | null>(null)
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchAll = useCallback(async () => {
    const [cars, rooms] = await Promise.all([
      supabase
        .from('car_reservations')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .order('date', { ascending: false }),
      supabase
        .from('room_reservations')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .order('date', { ascending: false })
        .order('start_time', { ascending: false }),
    ])

    const carItems = (cars.data || []).map(c => ({ ...c, _type: 'car' as const }))
    const roomItems = (rooms.data || []).map(r => ({ ...r, _type: 'room' as const }))
    const all = [...carItems, ...roomItems].sort((a, b) => b.date.localeCompare(a.date))
    setItems(all)
  }, [user.id])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    const ch1 = supabase.channel('my_car').on('postgres_changes', { event: '*', schema: 'public', table: 'car_reservations' }, fetchAll).subscribe()
    const ch2 = supabase.channel('my_room').on('postgres_changes', { event: '*', schema: 'public', table: 'room_reservations' }, fetchAll).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [fetchAll])

  const { refreshing, pullY, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(fetchAll, scrollRef)

  const handleCancel = async () => {
    if (!cancelTarget) return
    setLoading(true)
    try {
      const table = cancelTarget._type === 'car' ? 'car_reservations' : 'room_reservations'
      await supabase.from(table).update({ status: 'cancelled' }).eq('id', cancelTarget.id)
      setCancelTarget(null)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (d: string) => {
    const date = new Date(d + 'T00:00:00')
    const days = ['일','월','화','수','목','금','토']
    return `${date.getMonth() + 1}/${date.getDate()} (${days[date.getDay()]})`
  }

  const getIcon = (item: AnyReservation) => {
    if (item._type === 'car') return Car
    if ('resource_type' in item && item.resource_type === 'chamber') return Box
    return DoorOpen
  }

  const getLabel = (item: AnyReservation) => {
    if (item._type === 'car') return item.car_name
    return (item as RoomReservation).resource_name
  }

  const getDetail = (item: AnyReservation) => {
    if (item._type === 'car') return item.destination
    const r = item as RoomReservation
    return `${r.start_time}~${r.end_time} ${r.purpose}`
  }

  return (
    <div className="flex flex-col h-full" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <PullIndicator pullY={pullY} refreshing={refreshing} />
      {/* Header */}
      <div className="px-4 py-4 border-b border-(--color-border)">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold">{user.name}</h2>
            <p className="text-xs text-(--color-text-secondary)">{user.email}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onToggleDark} className="rounded-full p-2 hover:bg-(--color-border)">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button onClick={onLogout} className="rounded-full p-2 hover:bg-(--color-border) text-red-500">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Reservation list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-24 px-4">
        {(() => {
          const today = toLocalDateStr()
          const upcoming = items.filter(i => i.date >= today)
          const past = items.filter(i => i.date < today)

          const renderItem = (item: AnyReservation, isPast: boolean) => {
            const Icon = getIcon(item)
            return (
              <button
                key={`${item._type}-${item.id}`}
                onClick={() => !isPast && setCancelTarget(item)}
                className={`w-full flex items-center gap-3 rounded-xl bg-(--color-surface) border border-(--color-border) p-3 text-left transition-colors ${isPast ? 'opacity-50' : 'hover:border-(--color-primary-light)'}`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isPast ? 'bg-gray-200 dark:bg-gray-700' : 'bg-(--color-primary)/10'}`}>
                  <Icon size={20} className={isPast ? 'text-gray-400' : 'text-(--color-primary-light)'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{getLabel(item)}</span>
                    <span className="text-xs text-(--color-text-secondary)">{formatDate(item.date)}</span>
                    {isPast && <span className="text-[10px] text-(--color-text-secondary) bg-(--color-border) rounded px-1">지남</span>}
                  </div>
                  <p className="text-xs text-(--color-text-secondary) truncate">{getDetail(item)}</p>
                </div>
              </button>
            )
          }

          return (
            <>
              <h3 className="mt-4 mb-2 text-sm font-semibold text-(--color-text-secondary)">
                예정된 예약 ({upcoming.length})
              </h3>
              {upcoming.length === 0 ? (
                <div className="py-8 text-center text-(--color-text-secondary) text-sm">예정된 예약이 없습니다</div>
              ) : (
                <div className="space-y-2">{upcoming.map(i => renderItem(i, false))}</div>
              )}
              {past.length > 0 && (
                <>
                  <h3 className="mt-6 mb-2 text-sm font-semibold text-(--color-text-secondary)">
                    지난 예약 ({past.length})
                  </h3>
                  <div className="space-y-2">{past.map(i => renderItem(i, true))}</div>
                </>
              )}
            </>
          )
        })()}
      </div>

      {/* Cancel Modal */}
      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="예약 취소">
        {cancelTarget && (
          <div className="space-y-4">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-(--color-text-secondary)">리소스</span>
                <span className="font-medium">{getLabel(cancelTarget)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-(--color-text-secondary)">날짜</span>
                <span>{formatDate(cancelTarget.date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-(--color-text-secondary)">상세</span>
                <span className="truncate ml-4">{getDetail(cancelTarget)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCancelTarget(null)} className="flex-1 rounded-lg border border-(--color-border) py-3 text-sm font-medium text-(--color-text)">닫기</button>
              <button onClick={handleCancel} disabled={loading} className="flex-1 rounded-lg bg-red-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {loading ? '취소 중...' : '예약 취소'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
