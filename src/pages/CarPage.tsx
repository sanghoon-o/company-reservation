import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CARS, type CarReservation, type User } from '../lib/types'
import Modal from '../components/Modal'
import { toLocalDateStr } from '../lib/date'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullIndicator from '../components/PullIndicator'

interface Props { user: User }

export default function CarPage({ user }: Props) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [reservations, setReservations] = useState<CarReservation[]>([])
  const [modal, setModal] = useState<{ type: 'book' | 'detail'; date: string; car: string; reservation?: CarReservation } | null>(null)
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchReservations = useCallback(async () => {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const endDate = new Date(year, month + 1, 0)
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

    const { data } = await supabase
      .from('car_reservations')
      .select('*')
      .gte('date', startDate)
      .lte('date', endStr)
      .eq('status', 'confirmed')

    if (data) setReservations(data)
  }, [year, month])

  useEffect(() => { fetchReservations() }, [fetchReservations])

  useEffect(() => {
    const channel = supabase.channel(`car_rt_${year}_${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'car_reservations' }, () => {
        fetchReservations()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchReservations])

  const { refreshing, pullY, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(fetchReservations)

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const totalRows = Math.ceil((firstDayOfWeek + daysInMonth) / 7)
  const today = toLocalDateStr()

  const getReservation = (date: string, carName: string) =>
    reservations.find(r => r.date === date && r.car_name === carName)

  const handleCellClick = (date: string, carName: string) => {
    const res = getReservation(date, carName)
    if (!res) {
      if (date < today) return
      setDestination('')
      setReason('')
      setModal({ type: 'book', date, car: carName })
    } else {
      setModal({ type: 'detail', date, car: carName, reservation: res })
    }
  }

  const handleBook = async () => {
    if (!destination.trim() || !modal) return
    setLoading(true)
    try {
      const { error } = await supabase.from('car_reservations').insert({
        user_id: user.id,
        user_name: user.name,
        car_name: modal.car,
        date: modal.date,
        destination: destination.trim(),
        reason: reason.trim() || null,
      })
      if (error) {
        if (error.message.includes('duplicate') || error.code === '23505') {
          alert('이미 예약된 차량입니다.')
        } else {
          alert('예약 실패: ' + error.message)
        }
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
      await supabase
        .from('car_reservations')
        .update({ status: 'cancelled' })
        .eq('id', modal.reservation.id)
      await fetchReservations()
      setModal(null)
    } finally {
      setLoading(false)
    }
  }

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const formatDate = (d: string) => {
    const date = new Date(d + 'T00:00:00')
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  return (
    <div
      className="flex flex-col h-full"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <PullIndicator pullY={pullY} refreshing={refreshing} />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-(--color-bg)">
        <button onClick={prevMonth} className="rounded-full p-2 hover:bg-(--color-border)">
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-bold">{year}년 {month + 1}월</h2>
        <button onClick={nextMonth} className="rounded-full p-2 hover:bg-(--color-border)">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 px-4 pb-2 text-xs">
        {CARS.map(car => (
          <span key={car.name} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: car.color }} />
            {car.name}
          </span>
        ))}
      </div>

      {/* Calendar - flex fill, no scroll */}
      <div className="flex-1 flex flex-col px-2 pb-20 min-h-0">
        {/* Day headers */}
        <div className="grid grid-cols-7 text-center text-xs font-medium text-(--color-text-secondary) mb-1">
          {['일','월','화','수','목','금','토'].map(d => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>

        {/* Days grid - fills remaining space */}
        <div
          className="grid grid-cols-7 gap-px flex-1 min-h-0"
          style={{ gridTemplateRows: `repeat(${totalRows}, 1fr)` }}
        >
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isPast = dateStr < today
            const isToday = dateStr === today
            const dayOfWeek = new Date(year, month, day).getDay()

            return (
              <div
                key={day}
                className={`rounded-lg p-1 border flex flex-col ${
                  isToday ? 'border-(--color-primary-light)' : 'border-(--color-border)'
                } ${isPast ? 'opacity-50' : ''}`}
              >
                <div className={`text-xs font-medium mb-0.5 ${
                  dayOfWeek === 0 ? 'text-red-500' : dayOfWeek === 6 ? 'text-blue-500' : ''
                }`}>
                  {day}
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-h-0">
                  {CARS.map(car => {
                    const res = getReservation(dateStr, car.name)
                    const isMine = res?.user_id === user.id
                    return (
                      <button
                        key={car.name}
                        onClick={() => handleCellClick(dateStr, car.name)}
                        disabled={isPast && !res}
                        className="w-full rounded-sm px-1 flex-1 min-h-0 text-[10px] leading-tight truncate text-left transition-colors flex items-center"
                        style={{
                          backgroundColor: res
                            ? isMine ? '#3b82f6' : car.color
                            : `${car.color}18`,
                          color: res ? '#fff' : car.color,
                          opacity: isPast && !res ? 0.4 : 1,
                        }}
                      >
                        {res ? (isMine ? `✅${car.name[0]}` : `🔴${res.user_name}`) : car.name[0]}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Book Modal */}
      <Modal open={modal?.type === 'book'} onClose={() => setModal(null)} title="차량 예약">
        <div className="space-y-3">
          <div className="text-sm text-(--color-text-secondary)">
            {modal && formatDate(modal.date)} · <span className="font-semibold text-(--color-text)">{modal?.car}</span>
          </div>
          <input
            type="text"
            placeholder="행선지 *"
            value={destination}
            onChange={e => setDestination(e.target.value)}
            className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
          />
          <input
            type="text"
            placeholder="사유 (선택)"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
          />
          <button
            onClick={handleBook}
            disabled={!destination.trim() || loading}
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
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">차량</span><span className="font-medium">{modal.reservation.car_name}</span></div>
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">날짜</span><span>{formatDate(modal.reservation.date)}</span></div>
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">예약자</span><span className="font-medium">{modal.reservation.user_name}</span></div>
              <div className="flex justify-between"><span className="text-(--color-text-secondary)">행선지</span><span>{modal.reservation.destination}</span></div>
              {modal.reservation.reason && (
                <div className="flex justify-between"><span className="text-(--color-text-secondary)">사유</span><span>{modal.reservation.reason}</span></div>
              )}
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
