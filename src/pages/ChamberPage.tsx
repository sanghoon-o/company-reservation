import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CHAMBERS, type RoomReservation, type User } from '../lib/types'
import Modal from '../components/Modal'
import { toLocalDateStr } from '../lib/date'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullIndicator from '../components/PullIndicator'

interface Props { user: User }

// 챔버 공지: 4월 말까지, 하루 1회
const CHAMBER_NOTICE_END = '2026-04-30'
const CHAMBER_NOTICE_KEY = 'chamber_notice_last_shown'

const SLOTS: string[] = []
for (let h = 0; h < 23; h++) {
  SLOTS.push(`${String(h).padStart(2, '0')}:00`)
}

function getEndTimeOptions(start: string) {
  const idx = SLOTS.indexOf(start)
  return SLOTS.slice(idx + 1).concat(['23:00'])
}

export default function ChamberPage({ user }: Props) {
  const today = toLocalDateStr()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [selectedDate, setSelectedDate] = useState(today)
  const [reservations, setReservations] = useState<RoomReservation[]>([])
  const [modal, setModal] = useState<{ type: 'book' | 'detail'; slot: string; reservation?: RoomReservation } | null>(null)
  const [endTime, setEndTime] = useState('')
  const [purpose, setPurpose] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => {
    if (today > CHAMBER_NOTICE_END) return
    if (localStorage.getItem(CHAMBER_NOTICE_KEY) === today) return
    setShowNotice(true)
  }, [today])

  const dismissNotice = () => {
    setShowNotice(false)
    localStorage.setItem(CHAMBER_NOTICE_KEY, toLocalDateStr())
  }

  /* ── 월 단위 fetch ── */
  const fetchReservations = useCallback(async () => {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { data } = await supabase
      .from('room_reservations')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
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
  }, [year, month])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  useEffect(() => {
    const channel = supabase.channel(`chamber_rt_${year}_${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_reservations' }, () => {
        fetchReservations()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchReservations, year, month])

  /* ── 월 이동 ── */
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  /* ── 캘린더 계산 ── */
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const totalRows = Math.ceil((firstDayOfWeek + daysInMonth) / 7)

  const makeDateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  /* ── 선택된 날짜의 예약만 필터 ── */
  const dayReservations = reservations.filter(r => r.date === selectedDate)

  const getSlotReservation = (time: string) =>
    dayReservations.find(r =>
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
    const days = ['일','월','화','수','목','금','토']
    return `${date.getMonth() + 1}월 ${date.getDate()}일 (${days[date.getDay()]})`
  }

  const { refreshing, pullY, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(fetchReservations, scrollRef)

  return (
    <div className="flex flex-col h-full" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <PullIndicator pullY={pullY} refreshing={refreshing} />

      {/* ── Month header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-(--color-bg) border-b border-(--color-border)">
        <button onClick={prevMonth} className="rounded-full p-2 hover:bg-(--color-border)">
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-bold">{year}년 {month + 1}월</h2>
        <button onClick={nextMonth} className="rounded-full p-2 hover:bg-(--color-border)">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* ── Monthly calendar grid ── */}
      <div className="px-2 pt-1 pb-2 bg-(--color-bg) border-b border-(--color-border)">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 text-center text-xs font-medium text-(--color-text-secondary) mb-1">
          {['일','월','화','수','목','금','토'].map(d => (
            <div key={d} className={`py-1 ${d === '일' ? 'text-red-400' : d === '토' ? 'text-blue-400' : ''}`}>{d}</div>
          ))}
        </div>

        <div
          className="grid grid-cols-7 gap-px"
          style={{ gridTemplateRows: `repeat(${totalRows}, minmax(40px, 1fr))` }}
        >
          {/* Empty leading cells */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = makeDateStr(day)
            const isPast = dateStr < today
            const isToday = dateStr === today
            const isSelected = dateStr === selectedDate
            const dayOfWeek = new Date(year, month, day).getDay()
            const dayRes = reservations.filter(r => r.date === dateStr)
            const totalHours = dayRes.reduce((sum, r) => {
              const sh = parseInt(r.start_time)
              const eh = r.end_time === '23:00' ? 23 : parseInt(r.end_time)
              return sum + (eh - sh)
            }, 0)

            return (
              <button
                key={day}
                onClick={() => setSelectedDate(dateStr)}
                className={`relative rounded-lg p-1 border flex flex-col items-center transition-all ${
                  isSelected
                    ? 'border-(--color-primary) bg-(--color-primary)/10 shadow-sm'
                    : isToday
                      ? 'border-(--color-primary-light) bg-(--color-primary)/5'
                      : 'border-transparent hover:bg-(--color-surface)'
                } ${isPast ? 'opacity-50' : ''}`}
              >
                <span className={`text-xs font-medium ${
                  isSelected ? 'text-(--color-primary)' :
                  dayOfWeek === 0 ? 'text-red-500' : dayOfWeek === 6 ? 'text-blue-500' : 'text-(--color-text)'
                }`}>
                  {day}
                </span>
                {/* Reservation indicator */}
                {dayRes.length > 0 && (
                  <div className="mt-0.5 flex flex-col gap-px w-full px-0.5">
                    {totalHours >= 12 ? (
                      <div className="h-1.5 rounded-full bg-red-400/70 w-full" />
                    ) : dayRes.length > 0 ? (
                      <div className="h-1.5 rounded-full bg-blue-400/70 w-full" />
                    ) : null}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 px-2 pt-1.5 text-[10px] text-(--color-text-secondary)">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-1.5 rounded-full bg-blue-400/70" />
            예약 있음
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-1.5 rounded-full bg-red-400/70" />
            12시간 이상
          </span>
        </div>
      </div>

      {/* ── Selected date detail ── */}
      <div className="px-4 py-2 flex items-center justify-between bg-(--color-bg)">
        <span className="text-sm font-bold text-(--color-text)">{formatDateHeader(selectedDate)}</span>
        <span className="text-xs text-(--color-text-secondary)">24시간 운영 · 1시간 단위</span>
      </div>

      {/* ── Time slot grid ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-24 px-4">
        <div className="space-y-1">
          {SLOTS.map(time => {
            const res = getSlotReservation(time)
            const isMine = res?.user_id === user.id
            const isStart = res?.start_time === time

            if (res && !isStart) return null

            const span = res ? (
              (res.end_time === '23:00' ? SLOTS.length : SLOTS.indexOf(res.end_time)) - SLOTS.indexOf(res.start_time)
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
            {modal.reservation.user_id === user.id && selectedDate >= today ? (
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

      {/* 챔버 공지 팝업 */}
      {showNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={dismissNotice}>
          <div className="w-full max-w-sm rounded-2xl bg-(--color-surface) p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📢</span>
              <h3 className="text-lg font-bold text-(--color-text)">챔버 예약 안내</h3>
            </div>
            <div className="space-y-3 text-sm text-(--color-text) leading-relaxed">
              <p>
                챔버 예약 전 <strong className="text-(--color-primary)">위성사업센터에 사전 문의</strong> 부탁드립니다.
              </p>
              <p>
                4월 마지막 주(4/27~4/30)에 <strong className="text-(--color-primary)">DCU 시험 일정</strong>이 확정되어 있습니다.
              </p>
              <p className="text-(--color-text-secondary)">
                (3/16 기술회의부터 보고된 일정)
              </p>
              <p>
                해당 기간에 예약이 있으신 분은 <strong>일정 조정</strong>을 부탁드립니다.
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
