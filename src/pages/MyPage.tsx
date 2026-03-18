import { useState, useEffect, useCallback } from 'react'
import { Car, DoorOpen, Box, LogOut, Moon, Sun } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { CarReservation, RoomReservation, User } from '../lib/types'
import Modal from '../components/Modal'
import { toLocalDateStr } from '../lib/date'

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

  const today = toLocalDateStr()

  const fetchAll = useCallback(async () => {
    const [cars, rooms] = await Promise.all([
      supabase
        .from('car_reservations')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .gte('date', today)
        .order('date', { ascending: true }),
      supabase
        .from('room_reservations')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .gte('date', today)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true }),
    ])

    const carItems = (cars.data || []).map(c => ({ ...c, _type: 'car' as const }))
    const roomItems = (rooms.data || []).map(r => ({ ...r, _type: 'room' as const }))
    const all = [...carItems, ...roomItems].sort((a, b) => a.date.localeCompare(b.date))
    setItems(all)
  }, [user.id, today])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    const ch1 = supabase.channel('my_car').on('postgres_changes', { event: '*', schema: 'public', table: 'car_reservations' }, fetchAll).subscribe()
    const ch2 = supabase.channel('my_room').on('postgres_changes', { event: '*', schema: 'public', table: 'room_reservations' }, fetchAll).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [fetchAll])

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
    <div className="flex flex-col h-full">
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
      <div className="flex-1 overflow-y-auto pb-24 px-4">
        <h3 className="mt-4 mb-2 text-sm font-semibold text-(--color-text-secondary)">
          예정된 예약 ({items.length})
        </h3>
        {items.length === 0 ? (
          <div className="py-12 text-center text-(--color-text-secondary) text-sm">
            예정된 예약이 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => {
              const Icon = getIcon(item)
              return (
                <button
                  key={`${item._type}-${item.id}`}
                  onClick={() => setCancelTarget(item)}
                  className="w-full flex items-center gap-3 rounded-xl bg-(--color-surface) border border-(--color-border) p-3 text-left hover:border-(--color-primary-light) transition-colors"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--color-primary)/10">
                    <Icon size={20} className="text-(--color-primary-light)" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{getLabel(item)}</span>
                      <span className="text-xs text-(--color-text-secondary)">{formatDate(item.date)}</span>
                    </div>
                    <p className="text-xs text-(--color-text-secondary) truncate">{getDetail(item)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
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
