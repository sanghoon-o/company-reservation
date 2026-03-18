import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { MEETING_ROOMS, type RoomReservation, type User } from '../lib/types'
import Modal from '../components/Modal'

interface Props { user: User }

// 30분 단위 슬롯 09:00~18:00
const SLOTS: string[] = []
for (let h = 9; h < 18; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}
const HOURS = Array.from({ length: 10 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`)
const TOTAL_SLOTS = SLOTS.length // 18 slots

function getEndTimeOptions(start: string) {
  const idx = SLOTS.indexOf(start)
  return SLOTS.slice(idx + 1).concat(['18:00'])
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

const ROOM_INFO: Record<string, { label: string; color: string; capacity: string }> = {
  '미팅룸7': { label: '미팅룸7', color: '#6366f1', capacity: '8인실' },
  '미팅룸8': { label: '미팅룸8', color: '#0ea5e9', capacity: '4인실' },
}

// 예약 블록 색상 팔레트 (구분용)
const RESERVATION_COLORS = [
  { bg: 'rgba(244,163,149,0.45)', border: 'rgba(244,163,149,0.8)', text: '#b04a3a' },
  { bg: 'rgba(147,197,253,0.45)', border: 'rgba(147,197,253,0.8)', text: '#1e40af' },
  { bg: 'rgba(167,243,208,0.45)', border: 'rgba(167,243,208,0.8)', text: '#065f46' },
  { bg: 'rgba(253,224,71,0.40)', border: 'rgba(253,224,71,0.8)', text: '#854d0e' },
  { bg: 'rgba(196,181,253,0.45)', border: 'rgba(196,181,253,0.8)', text: '#5b21b6' },
  { bg: 'rgba(252,165,165,0.45)', border: 'rgba(252,165,165,0.8)', text: '#991b1b' },
]

function getColorForReservation(idx: number) {
  return RESERVATION_COLORS[idx % RESERVATION_COLORS.length]
}

function slotIndex(time: string): number {
  const idx = SLOTS.indexOf(time)
  if (idx >= 0) return idx
  // end_time이 18:00인 경우
  if (time === '18:00') return TOTAL_SLOTS
  return 0
}

export default function RoomPage({ user }: Props) {
  const dates = generateDates()
  const [selectedDate, setSelectedDate] = useState(dates[0])
  const [reservations, setReservations] = useState<RoomReservation[]>([])
  const [modal, setModal] = useState<{ type: 'book' | 'info' | 'cancel'; room: string; slot: string; reservation?: RoomReservation } | null>(null)
  const [endTime, setEndTime] = useState('')
  const [purpose, setPurpose] = useState('')
  const [loading, setLoading] = useState(false)
  const dateScrollRef = useRef<HTMLDivElement>(null)

  const fetchReservations = useCallback(async () => {
    const { data } = await supabase
      .from('room_reservations')
      .select('*')
      .eq('date', selectedDate)
      .eq('resource_type', 'meeting_room')
      .eq('status', 'confirmed')
    if (data) setReservations(data)
  }, [selectedDate])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  useEffect(() => {
    const channel = supabase.channel('room_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_reservations' }, () => {
        fetchReservations()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchReservations])

  const getRoomReservations = (room: string) =>
    reservations.filter(r => r.resource_name === room).sort((a, b) => a.start_time.localeCompare(b.start_time))

  const handleTimelineClick = (room: string, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = x / rect.width
    const slotIdx = Math.floor(pct * TOTAL_SLOTS)
    const clickedTime = SLOTS[Math.min(slotIdx, TOTAL_SLOTS - 1)]

    // 이미 예약된 슬롯인지 확인
    const existing = reservations.find(r =>
      r.resource_name === room && r.start_time <= clickedTime && r.end_time > clickedTime
    )
    if (existing) {
      if (existing.user_id === user.id) {
        setModal({ type: 'cancel', room, slot: clickedTime, reservation: existing })
      } else {
        setModal({ type: 'info', room, slot: clickedTime, reservation: existing })
      }
      return
    }

    setEndTime(getEndTimeOptions(clickedTime)[0] || '')
    setPurpose('')
    setModal({ type: 'book', room, slot: clickedTime })
  }

  const handleBook = async () => {
    if (!purpose.trim() || !modal) return
    setLoading(true)
    try {
      const { error } = await supabase.from('room_reservations').insert({
        user_id: user.id,
        user_name: user.name,
        resource_type: 'meeting_room',
        resource_name: modal.room,
        date: selectedDate,
        start_time: modal.slot,
        end_time: endTime,
        purpose: purpose.trim(),
      })
      if (error) {
        alert(error.message.includes('Time slot') ? '이미 예약된 시간입니다.' : '예약 실패: ' + error.message)
      } else {
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
        <div ref={dateScrollRef} className="flex gap-1 overflow-x-auto px-3 py-2 scrollbar-hide border-b border-(--color-border)">
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
      </div>

      {/* Room cards */}
      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4 space-y-5">
        {MEETING_ROOMS.map(room => {
          const info = ROOM_INFO[room]
          const roomRes = getRoomReservations(room)

          return (
            <div key={room} className="rounded-2xl border border-(--color-border) bg-(--color-surface) overflow-hidden shadow-sm">
              {/* Room header */}
              <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-white font-bold text-lg"
                  style={{ backgroundColor: info.color }}
                >
                  {room.replace('미팅룸', '')}
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-(--color-text)">{info.label}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-(--color-text-secondary)">
                      <Users size={12} /> {info.capacity}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-(--color-text-secondary)">
                  {roomRes.length > 0 ? `${roomRes.length}건 예약` : '예약 없음'}
                </div>
              </div>

              {/* Timeline */}
              <div className="px-4 pb-4">
                {/* Hour labels */}
                <div className="relative h-5 mb-1">
                  {HOURS.map((h, i) => (
                    <span
                      key={h}
                      className="absolute text-[10px] text-(--color-text-secondary) -translate-x-1/2"
                      style={{ left: `${(i / (HOURS.length - 1)) * 100}%` }}
                    >
                      {h.replace(':00', '')}
                    </span>
                  ))}
                </div>

                {/* Timeline bar */}
                <div
                  className="relative h-14 rounded-xl bg-(--color-bg) border border-(--color-border) cursor-pointer overflow-hidden"
                  onClick={(e) => handleTimelineClick(room, e)}
                >
                  {/* Hour grid lines */}
                  {HOURS.map((h, i) => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 w-px bg-(--color-border)"
                      style={{ left: `${(i / (HOURS.length - 1)) * 100}%` }}
                    />
                  ))}

                  {/* Reservation blocks */}
                  {roomRes.map((res, idx) => {
                    const startIdx = slotIndex(res.start_time)
                    const endIdx = slotIndex(res.end_time)
                    const leftPct = (startIdx / TOTAL_SLOTS) * 100
                    const widthPct = ((endIdx - startIdx) / TOTAL_SLOTS) * 100
                    const color = res.user_id === user.id
                      ? { bg: 'rgba(96,165,250,0.35)', border: 'rgba(96,165,250,0.8)', text: '#1e40af' }
                      : getColorForReservation(idx)

                    return (
                      <div
                        key={res.id}
                        className="absolute top-1 bottom-1 rounded-lg flex flex-col justify-center px-2 overflow-hidden transition-transform active:scale-[0.98]"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: color.bg,
                          borderLeft: `3px solid ${color.border}`,
                          backgroundImage: `repeating-linear-gradient(135deg, transparent, transparent 4px, ${color.border} 4px, ${color.border} 5px)`,
                          backgroundSize: '8px 8px',
                          backgroundPositionX: '0',
                        }}
                      >
                        <div className="relative z-10 bg-white/60 dark:bg-black/30 rounded px-1 py-0.5 inline-block w-fit max-w-full">
                          <span className="text-[11px] font-bold truncate block" style={{ color: color.text }}>
                            {res.user_name}
                          </span>
                        </div>
                        {widthPct > 15 && (
                          <span className="relative z-10 text-[9px] mt-0.5 truncate opacity-70" style={{ color: color.text }}>
                            {res.start_time}~{res.end_time}
                          </span>
                        )}
                      </div>
                    )
                  })}

                  {/* Current time indicator */}
                  {selectedDate === new Date().toISOString().split('T')[0] && (() => {
                    const now = new Date()
                    const currentMinutes = now.getHours() * 60 + now.getMinutes()
                    const startMinutes = 9 * 60
                    const endMinutes = 18 * 60
                    if (currentMinutes < startMinutes || currentMinutes > endMinutes) return null
                    const pct = ((currentMinutes - startMinutes) / (endMinutes - startMinutes)) * 100
                    return (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" style={{ left: `${pct}%` }}>
                        <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Book Modal */}
      <Modal open={modal?.type === 'book'} onClose={() => setModal(null)} title="미팅룸 예약">
        <div className="space-y-3">
          <div className="text-sm text-(--color-text-secondary)">
            <strong className="text-(--color-text)">{modal?.room}</strong> · {modal?.slot}~
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

      {/* Info Modal */}
      <Modal open={modal?.type === 'info'} onClose={() => setModal(null)} title="예약 정보">
        {modal?.reservation && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-(--color-text-secondary)">미팅룸</span><span className="font-medium">{modal.reservation.resource_name}</span></div>
            <div className="flex justify-between"><span className="text-(--color-text-secondary)">시간</span><span>{modal.reservation.start_time} ~ {modal.reservation.end_time}</span></div>
            <div className="flex justify-between"><span className="text-(--color-text-secondary)">예약자</span><span>{modal.reservation.user_name}</span></div>
            <div className="flex justify-between"><span className="text-(--color-text-secondary)">목적</span><span>{modal.reservation.purpose}</span></div>
          </div>
        )}
      </Modal>

      {/* Cancel Modal */}
      <Modal open={modal?.type === 'cancel'} onClose={() => setModal(null)} title="예약 취소">
        {modal?.reservation && (
          <div className="space-y-4">
            <p className="text-sm text-(--color-text-secondary)">
              {modal.reservation.resource_name} {modal.reservation.start_time}~{modal.reservation.end_time} 예약을 취소하시겠습니까?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} className="flex-1 rounded-lg border border-(--color-border) py-3 text-sm font-medium text-(--color-text)">닫기</button>
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
