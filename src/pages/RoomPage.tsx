import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { MEETING_ROOMS, type RoomReservation, type User } from '../lib/types'
import Modal from '../components/Modal'
import { toLocalDateStr } from '../lib/date'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullIndicator from '../components/PullIndicator'

interface Props { user: User }

// 30분 단위 슬롯 09:00~18:00
const SLOTS: string[] = []
for (let h = 9; h < 18; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}
const HOURS = Array.from({ length: 10 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`)

/** HH:MM:SS 또는 HH:MM → HH:MM 변환 */
function normalizeTime(t: string): string {
  return t.slice(0, 5)
}

/** 시간을 타임라인 퍼센트로 변환 (09:00=0%, 18:00=100%) */
function timeToPercent(time: string): number {
  const t = normalizeTime(time)
  const [h, m] = t.split(':').map(Number)
  const minutes = h * 60 + m
  return ((minutes - 540) / 540) * 100  // 540 = 9*60, range = 18*60-9*60 = 540
}

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
    dates.push(toLocalDateStr(d))
  }
  return dates
}

const ROOM_INFO: Record<string, { color: string; reservationColor: { bg: string; border: string; text: string } }> = {
  '미팅룸7': {
    color: '#6366f1',
    reservationColor: { bg: 'rgba(96,165,250,0.35)', border: 'rgba(96,165,250,0.8)', text: '#1e40af' },
  },
  '미팅룸8': {
    color: '#0ea5e9',
    reservationColor: { bg: 'rgba(251,182,206,0.45)', border: 'rgba(244,143,177,0.8)', text: '#9d174d' },
  },
}


export default function RoomPage({ user }: Props) {
  const dates = generateDates()
  const [selectedDate, setSelectedDate] = useState(dates[0])
  const [reservations, setReservations] = useState<RoomReservation[]>([])
  const [modal, setModal] = useState<{ type: 'book' | 'detail'; room: string; slot: string; reservation?: RoomReservation } | null>(null)
  const [endTime, setEndTime] = useState('')
  const [purpose, setPurpose] = useState('')
  const [loading, setLoading] = useState(false)
  const dateScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchReservations = useCallback(async () => {
    const { data } = await supabase
      .from('room_reservations')
      .select('*')
      .eq('date', selectedDate)
      .eq('resource_type', 'meeting_room')
      .eq('status', 'confirmed')
    if (data) {
      // Supabase TIME은 HH:MM:SS로 올 수 있으므로 HH:MM으로 정규화
      const normalized = data.map(r => ({
        ...r,
        start_time: normalizeTime(r.start_time),
        end_time: normalizeTime(r.end_time),
      }))
      setReservations(normalized)
    }
  }, [selectedDate])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  useEffect(() => {
    const channel = supabase.channel(`room_rt_${selectedDate}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_reservations' }, () => {
        fetchReservations()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchReservations, selectedDate])

  const getRoomReservations = (room: string) =>
    reservations.filter(r => r.resource_name === room).sort((a, b) => a.start_time.localeCompare(b.start_time))

  const getSlotFromClick = (e: React.MouseEvent<HTMLDivElement>): string => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = x / rect.width
    const totalMinutes = pct * 540 // 9시간 = 540분
    const slotMinutes = Math.floor(totalMinutes / 30) * 30
    const h = Math.floor((540 + slotMinutes) / 60)
    const m = (540 + slotMinutes) % 60
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    // 범위 제한
    if (time < '09:00') return '09:00'
    if (time >= '18:00') return '17:30'
    return time
  }

  const handleTimelineClick = (room: string, e: React.MouseEvent<HTMLDivElement>) => {
    const clickedTime = getSlotFromClick(e)

    const existing = reservations.find(r =>
      r.resource_name === room && r.start_time <= clickedTime && r.end_time > clickedTime
    )
    if (existing) {
      setModal({ type: 'detail', room, slot: clickedTime, reservation: existing })
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
        await fetchReservations() // 즉시 리페치
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
      await fetchReservations() // 즉시 리페치
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

  const { refreshing, pullY, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(fetchReservations, scrollRef)

  return (
    <div className="flex flex-col h-full" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <PullIndicator pullY={pullY} refreshing={refreshing} />
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
            const isToday = d === toLocalDateStr()
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-24 px-4 pt-4 space-y-5">
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
                  <h3 className="text-base font-bold text-(--color-text)">{room}</h3>
                </div>
                <div className="text-xs text-(--color-text-secondary)">
                  {roomRes.length > 0 ? `${roomRes.length}건 예약` : '예약 없음'}
                </div>
              </div>

              {/* Timeline - 횡스크롤 */}
              <div className="overflow-x-auto pb-4 px-4 scrollbar-hide">
                <div style={{ width: '700px', minWidth: '700px' }}>
                  {/* Hour labels */}
                  <div className="relative h-5 mb-1">
                    {HOURS.map(h => {
                      const pct = timeToPercent(h)
                      return (
                        <span
                          key={h}
                          className="absolute text-[11px] text-(--color-text-secondary) -translate-x-1/2"
                          style={{ left: `${pct}%` }}
                        >
                          {h.replace(':00', '')}
                        </span>
                      )
                    })}
                  </div>

                  {/* Timeline bar */}
                  <div
                    className="relative h-16 rounded-xl bg-(--color-bg) border border-(--color-border) cursor-pointer overflow-hidden"
                    onClick={(e) => handleTimelineClick(room, e)}
                  >
                    {/* Hour grid lines */}
                    {HOURS.map(h => {
                      const pct = timeToPercent(h)
                      return (
                        <div
                          key={h}
                          className="absolute top-0 bottom-0 w-px bg-(--color-border)"
                          style={{ left: `${pct}%` }}
                        />
                      )
                    })}

                    {/* Reservation blocks */}
                    {roomRes.map((res) => {
                      const leftPct = timeToPercent(res.start_time)
                      const rightPct = timeToPercent(res.end_time)
                      const widthPct = rightPct - leftPct
                      const color = info.reservationColor

                      return (
                        <div
                          key={res.id}
                          className="absolute top-1 bottom-1 rounded-lg flex flex-col justify-center px-2 overflow-hidden"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            backgroundColor: color.bg,
                            borderLeft: `3px solid ${color.border}`,
                            backgroundImage: `repeating-linear-gradient(135deg, transparent, transparent 3px, ${color.border} 3px, ${color.border} 4px)`,
                            backgroundSize: '7px 7px',
                          }}
                        >
                          <div className="relative z-10 bg-white/70 dark:bg-black/40 rounded px-1 py-0.5 inline-block w-fit max-w-full">
                            <span className="text-xs font-bold truncate block" style={{ color: color.text }}>
                              {res.user_name}
                            </span>
                          </div>
                          <span className="relative z-10 text-[10px] mt-0.5 truncate opacity-80" style={{ color: color.text }}>
                            {res.start_time}~{res.end_time}
                          </span>
                        </div>
                      )
                    })}

                    {/* Current time indicator */}
                    {selectedDate === toLocalDateStr() && (() => {
                      const now = new Date()
                      const currentMinutes = now.getHours() * 60 + now.getMinutes()
                      if (currentMinutes < 540 || currentMinutes > 1080) return null
                      const pct = ((currentMinutes - 540) / 540) * 100
                      return (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" style={{ left: `${pct}%` }}>
                          <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                        </div>
                      )
                    })()}
                  </div>
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

      {/* Detail Modal (예약 정보 + 본인이면 취소) */}
      <Modal open={modal?.type === 'detail'} onClose={() => setModal(null)} title="예약 정보">
        {modal?.reservation && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">미팅룸</span><span className="font-medium">{modal.reservation.resource_name}</span></div>
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
