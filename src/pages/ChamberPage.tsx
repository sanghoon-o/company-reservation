import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CHAMBERS, type RoomReservation, type User } from '../lib/types'
import Modal from '../components/Modal'

interface Props { user: User }

const SLOTS: string[] = []
for (let h = 0; h < 23; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`)
}

function getEndTimeOptions(start: string) {
  const idx = SLOTS.indexOf(start)
  return SLOTS.slice(idx + 1).concat(['23:00'])
}

function generateDates(): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i <= 30; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

export default function ChamberPage({ user }: Props) {
  const dates = generateDates()
  const [selectedDate, setSelectedDate] = useState(dates[0])
  const [reservations, setReservations] = useState<RoomReservation[]>([])
  const [modal, setModal] = useState<{ type: 'book' | 'detail'; slot: string; reservation?: RoomReservation } | null>(null)
  const [endTime, setEndTime] = useState('')
  const [purpose, setPurpose] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchReservations = useCallback(async () => {
    const { data } = await supabase
      .from('room_reservations')
      .select('*')
      .eq('date', selectedDate)
      .eq('resource_type', 'chamber')
      .eq('status', 'confirmed')
    if (data) {
      const normalized = data.map(r => ({
        ...r,
        start_time: r.start_time.slice(0, 5),
        end_time: r.end_time.slice(0, 5),
      }))
      setReservations(normalized)
    }
  }, [selectedDate])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  useEffect(() => {
    const channel = supabase.channel(`chamber_rt_${selectedDate}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_reservations' }, () => {
        fetchReservations()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchReservations, selectedDate])

  const getSlotReservation = (time: string) =>
    reservations.find(r =>
      r.resource_name === CHAMBERS[0] && r.start_time <= time && r.end_time > time
    )

  const handleSlotClick = (time: string) => {
    const res = getSlotReservation(time)
    if (res) {
      setModal({ type: 'detail', slot: time, reservation: res })
      return
    }
    setEndTime(getEndTimeOptions(time)[0] || '')
    setPurpose('')
    setModal({ type: 'book', slot: time })
  }

  const handleBook = async () => {
    if (!purpose.trim() || !modal) return
    setLoading(true)
    try {
      const { error } = await supabase.from('room_reservations').insert({
        user_id: user.id,
        user_name: user.name,
        resource_type: 'chamber',
        resource_name: CHAMBERS[0],
        date: selectedDate,
        start_time: modal.slot,
        end_time: endTime,
        purpose: purpose.trim(),
      })
      if (error) {
        alert(error.message.includes('Time slot') ? '이미 예약된 시간입니다.' : '예약 실패: ' + error.message)
      } else {
        await fetchReservations()
        setModal(null)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!modal?.reservation) return
    setLoading(true)
    try {
      await supabase.from('room_reservations').update({ status: 'cancelled' }).eq('id', modal.reservation.id)
      await fetchReservations()
      setModal(null)
    } finally {
      setLoading(false)
    }
  }

  const formatDateHeader = (d: string) => {
    const date = new Date(d + 'T00:00:00')
    const days = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일']
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 · ${days[date.getDay()]}`
  }

  const formatDateChip = (d: string) => {
    const date = new Date(d + 'T00:00:00')
    const days = ['일','월','화','수','목','금','토']
    return { day: date.getDate(), dow: days[date.getDay()], isWeekend: date.getDay() === 0 || date.getDay() === 6 }
  }

  const navigateDate = (dir: -1 | 1) => {
    const idx = dates.indexOf(selectedDate)
    const next = idx + dir
    if (next >= 0 && next < dates.length) setSelectedDate(dates[next])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Date header */}
      <div className="sticky top-0 z-10 bg-(--color-bg)">
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--color-border)">
          <button onClick={() => navigateDate(-1)} className="rounded-full p-1.5 hover:bg-(--color-border)">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-bold text-(--color-text)">{formatDateHeader(selectedDate)}</span>
          <button onClick={() => navigateDate(1)} className="rounded-full p-1.5 hover:bg-(--color-border)">
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Date chips */}
        <div className="flex gap-1 overflow-x-auto px-3 py-2 scrollbar-hide border-b border-(--color-border)">
          {dates.map(d => {
            const { day, dow, isWeekend } = formatDateChip(d)
            const isActive = d === selectedDate
            const isToday = d === new Date().toISOString().split('T')[0]
            return (
              <button
                key={d}
                onClick={() => setSelectedDate(d)}
                className={`flex flex-col items-center shrink-0 w-10 py-1.5 rounded-xl text-[11px] transition-all ${
                  isActive
                    ? 'bg-(--color-primary) text-white shadow-md'
                    : isToday
                      ? 'bg-(--color-primary)/10 text-(--color-primary-light)'
                      : 'text-(--color-text-secondary) hover:bg-(--color-border)'
                }`}
              >
                <span className={`text-[10px] ${isWeekend && !isActive ? 'text-red-400' : ''}`}>{dow}</span>
                <span className="text-sm font-bold">{day}</span>
              </button>
            )
          })}
        </div>

        <div className="px-4 py-2 text-xs text-(--color-text-secondary)">
          24시간 운영 · 1시간 단위
        </div>
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto pb-24 px-4">
        <div className="space-y-1">
          {SLOTS.map(time => {
            const res = getSlotReservation(time)
            const isMine = res?.user_id === user.id
            const isStart = res?.start_time === time

            if (res && !isStart) return null

            const span = res ? (
              SLOTS.indexOf(res.end_time === '23:00' ? '23:00' : res.end_time) - SLOTS.indexOf(res.start_time)
            ) : 1

            return (
              <button
                key={time}
                onClick={() => handleSlotClick(time)}
                className={`w-full rounded-xl text-left transition-colors ${
                  res
                    ? isMine
                      ? 'bg-blue-500/15 border border-blue-400/30'
                      : 'bg-red-500/10 border border-red-400/30'
                    : 'bg-(--color-surface) border border-(--color-border) hover:border-(--color-primary-light)'
                }`}
                style={{ minHeight: `${span * 48}px`, padding: '10px 14px' }}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${res ? (isMine ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400') : 'text-(--color-text)'}`}>
                    {time} ~ {res ? res.end_time : `${String(parseInt(time) + 1).padStart(2, '0')}:00`}
                  </span>
                  {res && (
                    <span className={`text-xs font-semibold ${isMine ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                      {res.user_name}
                    </span>
                  )}
                </div>
                {res && <div className="mt-1 text-xs text-(--color-text-secondary) truncate">{res.purpose}</div>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Book Modal */}
      <Modal open={modal?.type === 'book'} onClose={() => setModal(null)} title="챔버 예약">
        <div className="space-y-3">
          <div className="text-sm text-(--color-text-secondary)">
            {formatDateHeader(selectedDate)} · {modal?.slot}~
          </div>
          <select
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none"
          >
            {modal && getEndTimeOptions(modal.slot).map(t => (
              <option key={t} value={t}>~{t}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="목적 *"
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
          />
          <button
            onClick={handleBook}
            disabled={!purpose.trim() || loading}
            className="w-full rounded-lg bg-(--color-primary) py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? '예약 중...' : '예약하기'}
          </button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={modal?.type === 'detail'} onClose={() => setModal(null)} title="예약 정보">
        {modal?.reservation && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">챔버</span><span className="font-medium">{modal.reservation.resource_name}</span></div>
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">시간</span><span>{modal.reservation.start_time} ~ {modal.reservation.end_time}</span></div>
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">예약자</span><span className="font-medium">{modal.reservation.user_name}</span></div>
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">목적</span><span>{modal.reservation.purpose}</span></div>
            </div>
            {modal.reservation.user_id === user.id ? (
              <div className="flex gap-2">
                <button onClick={() => setModal(null)} className="flex-1 rounded-lg border border-(--color-border) py-3 text-sm font-medium text-(--color-text)">닫기</button>
                <button onClick={handleCancel} disabled={loading} className="flex-1 rounded-lg bg-red-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
                  {loading ? '취소 중...' : '예약 취소'}
                </button>
              </div>
            ) : (
              <button onClick={() => setModal(null)} className="w-full rounded-lg border border-(--color-border) py-3 text-sm font-medium text-(--color-text)">닫기</button>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
