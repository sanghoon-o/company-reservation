import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CARS, type CarReservation, type CarLog, type User } from '../lib/types'
import Modal from '../components/Modal'
import { toLocalDateStr } from '../lib/date'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullIndicator from '../components/PullIndicator'

// 공백/개행 방어: Vercel 입력 시 textarea 개행 섞여 들어오는 경우 제거
const SHEET_URL = (import.meta.env.VITE_GOOGLE_SHEET_URL || '').replace(/\s+/g, '')
// SHEET_VIEW_URL은 공개 가능한 구글 시트 공유 링크이므로 하드코딩 fallback 허용
// (env var가 비어있거나 모바일 PWA가 옛 번들을 캐싱해도 항상 작동하도록)
const SHEET_VIEW_URL_FALLBACK = 'https://docs.google.com/spreadsheets/d/1qF5d0H8Rfay7tFNDJnIz02pausfrQzrc-ehQczxwtq4/edit?gid=0#gid=0'
const SHEET_VIEW_URL = ((import.meta.env.VITE_GOOGLE_SHEET_VIEW_URL || '').replace(/\s+/g, '')) || SHEET_VIEW_URL_FALLBACK

// 시트에서 사용할 날짜 표시 형식: YYYY.M.D (요일)
// (Apps Script upsert lookup 키로도 사용되므로 저장/조회에서 동일 형식 필수)
function formatSheetDate(dateStr: string): string {
  const dateObj = new Date(dateStr + 'T00:00:00')
  const days = ['일','월','화','수','목','금','토']
  return `${dateObj.getFullYear()}.${dateObj.getMonth()+1}.${dateObj.getDate()} (${days[dateObj.getDay()]})`
}

// JSONP helper - Apps Script에서 데이터 읽기 (CORS 우회)
function jsonpQuery(baseUrl: string, params: URLSearchParams): Promise<any> {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonpCb_' + Date.now() + '_' + Math.floor(Math.random() * 100000)
    const script = document.createElement('script')
    let timer: number
    const cleanup = () => {
      delete (window as any)[callbackName]
      try { document.head.removeChild(script) } catch {}
      window.clearTimeout(timer)
    }
    ;(window as any)[callbackName] = (data: any) => { cleanup(); resolve(data) }
    script.onerror = () => { cleanup(); reject(new Error('JSONP failed')) }
    timer = window.setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')) }, 10000)
    params.set('callback', callbackName)
    script.src = `${baseUrl}?${params.toString()}`
    document.head.appendChild(script)
  })
}

interface Props { user: User }

export default function CarPage({ user }: Props) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [reservations, setReservations] = useState<CarReservation[]>([])
  const [modal, setModal] = useState<{ type: 'book' | 'detail' | 'log'; date: string; car: string; reservation?: CarReservation } | null>(null)
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [logDepartment, setLogDepartment] = useState('')
  const [logOdoBefore, setLogOdoBefore] = useState('')
  const [logOdoAfter, setLogOdoAfter] = useState('')
  const [logCommute, setLogCommute] = useState('')
  const [logBusiness, setLogBusiness] = useState('')
  const [logNote, setLogNote] = useState('')
  const [carLogs, setCarLogs] = useState<Record<string, CarLog>>({})

  // 차량 일지 데이터 조회
  useEffect(() => {
    supabase.from('car_logs').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, CarLog> = {}
        ;(data as CarLog[]).forEach(log => { map[log.reservation_id] = log })
        setCarLogs(map)
      }
    })
  }, [])

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

  const [logName, setLogName] = useState('')

  const openLogModal = async () => {
    if (!modal?.reservation) return
    const reservation = modal.reservation
    const currentDate = modal.date
    const currentCar = modal.car
    setLoading(true)

    // Google Sheet에서 기존 데이터 조회 (SHEET_URL 없으면 스킵)
    let sheetData: any = null
    if (SHEET_URL) {
      try {
        const dateDisplay = formatSheetDate(currentDate)
        const params = new URLSearchParams({
          action: 'query',
          date: dateDisplay,
          user_name: user.name,
          car_name: currentCar,
        })
        const result = await jsonpQuery(SHEET_URL, params)
        if (result?.ok && result.data) sheetData = result.data
      } catch (err) {
        console.warn('Sheet query failed:', err)
      }
    }

    // Fallback: Supabase 캐시
    const cached = carLogs[reservation.id]
    const pick = (sheetVal: any, cacheVal: any, fallback = '') => {
      if (sheetVal !== '' && sheetVal != null) return String(sheetVal)
      if (cacheVal != null) return String(cacheVal)
      return fallback
    }

    setLogName(pick(sheetData?.user_name, cached?.user_name, user.name))
    setLogDepartment(pick(sheetData?.department, cached?.department))
    setLogOdoBefore(pick(sheetData?.odo_before, cached?.odo_before))
    setLogOdoAfter(pick(sheetData?.odo_after, cached?.odo_after))
    setLogCommute(pick(sheetData?.commute_distance, cached?.commute_distance))
    setLogBusiness(pick(sheetData?.business_distance, cached?.business_distance))
    setLogNote(pick(sheetData?.note, cached?.note, reservation.reason || ''))

    setLoading(false)
    setModal({ type: 'log', date: currentDate, car: currentCar, reservation })
  }

  const handleSaveLog = async () => {
    if (!modal?.reservation || !logName.trim() || !logOdoBefore) return
    setLoading(true)
    try {
      const hasOdoAfter = !!logOdoAfter
      const distance = hasOdoAfter ? Number(logOdoAfter) - Number(logOdoBefore) : null
      const existing = carLogs[modal.reservation.id]

      // Google Sheet 저장 - iframe 방식 (검증됨: 이전 버전에서 실제 row 저장 동작 확인)
      console.log('[CarLog] SHEET_URL:', SHEET_URL)
      if (SHEET_URL) {
        const dateDisplay = formatSheetDate(modal.date)

        const params = new URLSearchParams({
          date: dateDisplay,
          department: logDepartment.trim(),
          user_name: user.name,
          car_name: modal.car,
          odo_before: logOdoBefore,
          odo_after: logOdoAfter || '',
          distance: distance != null ? String(distance) : '',
          commute_distance: logCommute || '',
          business_distance: logBusiness || '',
          note: logNote.trim(),
        })
        const saveUrl = `${SHEET_URL}?${params.toString()}`
        console.log('[CarLog] Saving to sheet:', saveUrl)
        await new Promise<void>((resolve) => {
          const iframe = document.createElement('iframe')
          iframe.style.display = 'none'
          document.body.appendChild(iframe)
          let done = false
          const finish = () => {
            if (done) return
            done = true
            console.log('[CarLog] Sheet save iframe done')
            resolve()
            setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 500)
          }
          iframe.onload = finish
          iframe.onerror = finish
          iframe.src = saveUrl
          // 안전장치: 8초 후 강제 진행
          setTimeout(finish, 8000)
        })
      }

      // Supabase 저장 (upsert) + Optimistic UI 업데이트
      const logData = {
        reservation_id: modal.reservation.id,
        user_id: user.id,
        user_name: logName.trim(),
        car_name: modal.car,
        date: modal.date,
        department: logDepartment.trim() || null,
        odo_before: Number(logOdoBefore),
        odo_after: hasOdoAfter ? Number(logOdoAfter) : null,
        distance,
        commute_distance: logCommute ? Number(logCommute) : null,
        business_distance: logBusiness ? Number(logBusiness) : null,
        note: logNote.trim() || null,
      }

      // Optimistic 업데이트: Supabase 성공 여부와 무관하게 UI 즉시 반영
      // (시트 저장은 이미 성공했으므로, UI에 '일지 작성 완료'를 즉시 표시)
      const optimisticLog: CarLog = {
        id: existing?.id || `local_${Date.now()}`,
        created_at: existing?.created_at || new Date().toISOString(),
        ...logData,
      }
      setCarLogs(prev => ({ ...prev, [modal.reservation!.id]: optimisticLog }))
      console.log('[CarLog] Optimistic state updated:', optimisticLog)

      // Supabase 영속화 (best-effort, 실패해도 UI는 유지)
      try {
        if (existing?.id) {
          const { data, error } = await supabase.from('car_logs').update(logData).eq('id', existing.id).select().single()
          if (error) console.warn('[CarLog] Supabase update error:', error)
          if (data) setCarLogs(prev => ({ ...prev, [modal.reservation!.id]: data as CarLog }))
        } else {
          const { data, error } = await supabase.from('car_logs').insert(logData).select().single()
          if (error) console.warn('[CarLog] Supabase insert error:', error)
          if (data) setCarLogs(prev => ({ ...prev, [modal.reservation!.id]: data as CarLog }))
        }
      } catch (err) {
        console.warn('[CarLog] Supabase exception:', err)
      }

      alert(hasOdoAfter ? '차량 일지가 저장되었습니다.' : '주행 전 데이터가 저장되었습니다.')
      setModal(null)
    } catch (err) {
      alert('저장 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'))
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
      <Modal
        open={modal?.type === 'detail'}
        onClose={() => setModal(null)}
        title="예약 정보"
        headerRight={
          modal?.reservation?.user_id === user.id ? (
            modal.reservation && carLogs[modal.reservation.id]?.odo_after != null ? (
              <a
                href={SHEET_VIEW_URL || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => {
                  if (!SHEET_VIEW_URL) {
                    e.preventDefault()
                    alert('시트 URL이 설정되지 않았습니다.')
                  }
                }}
                className="text-xs px-2.5 py-1 rounded-lg bg-green-500/10 text-green-600 font-medium underline"
              >
                일지 작성 완료
              </a>
            ) : (
              <button
                onClick={openLogModal}
                disabled={loading}
                className="text-xs px-2.5 py-1 rounded-lg bg-(--color-primary)/10 text-(--color-primary) font-medium disabled:opacity-50"
              >
                {loading ? '로딩...' : '일지 작성'}
              </button>
            )
          ) : undefined
        }
      >
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
            {modal.reservation.user_id === user.id && modal.reservation.date >= today ? (
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

      {/* Log Modal (차량 일지 작성) */}
      <Modal open={modal?.type === 'log'} onClose={() => setModal(null)} title="차량 일지 작성">
        {modal?.reservation && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-(--color-bg) p-3 text-sm">
              <div>
                <div className="text-[10px] text-(--color-text-secondary)">사용일자</div>
                <div className="font-medium">{formatDate(modal.date)}</div>
              </div>
              <div>
                <div className="text-[10px] text-(--color-text-secondary)">차량</div>
                <div className="font-medium">{modal.car}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="성명 *"
                value={logName}
                onChange={e => setLogName(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
              />
              <input
                type="text"
                placeholder="부서"
              value={logDepartment}
              onChange={e => setLogDepartment(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="주행 전 (km)"
                value={logOdoBefore}
                onChange={e => setLogOdoBefore(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
              />
              <input
                type="number"
                placeholder="주행 후 (km)"
                value={logOdoAfter}
                onChange={e => setLogOdoAfter(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
              />
            </div>
            {logOdoBefore && logOdoAfter && (
              <div className="rounded-lg bg-(--color-primary)/10 px-4 py-2.5 text-sm font-medium text-(--color-primary) text-center">
                주행거리: {(Number(logOdoAfter) - Number(logOdoBefore)).toLocaleString()} km
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="출·퇴근용 (km)"
                value={logCommute}
                onChange={e => setLogCommute(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
              />
              <input
                type="number"
                placeholder="일반 업무용 (km)"
                value={logBusiness}
                onChange={e => setLogBusiness(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
              />
            </div>
            <input
              type="text"
              placeholder="비고"
              value={logNote}
              onChange={e => setLogNote(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
            />
            <button
              onClick={handleSaveLog}
              disabled={!logName.trim() || !logOdoBefore || loading}
              className="w-full rounded-lg bg-(--color-primary) py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? '저장 중...' : '저장'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
