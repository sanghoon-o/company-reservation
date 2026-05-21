import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Instrument, InstrumentUsage, User } from '../lib/types'
import { toLocalDateStr } from '../lib/date'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import PullIndicator from '../components/PullIndicator'

interface Props { user: User }

// Google Sheet 연동 (env에 미설정이면 시트 업데이트 스킵 + 보기 링크 비활성)
const SHEET_URL = (import.meta.env.VITE_GOOGLE_SHEET_INSTRUMENT_URL || '').replace(/\s+/g, '')
const SHEET_VIEW_URL = (import.meta.env.VITE_GOOGLE_SHEET_VIEW_INSTRUMENT_URL || '').replace(/\s+/g, '')

// 시트 → DB 동기화 권한 (품질팀)
const SYNC_ALLOWED_EMAILS = new Set([
  'jhhan@iedel.com',
  'dykim@iedel.com',
  'jscho@iedel.com',
  'mschun@iedel.com',
  'sbkim@iedel.com',
  'shoh@iedel.com',
])

// 시트 row 타입 (Apps Script action=dump가 반환하는 형태)
interface SheetInstrumentRow {
  instrument_no: string | null
  name: string | null
  english_name: string | null
  model: string | null
  serial_number: string | null
  manufacturer: string | null
  specification: string | null
  purchase_price: string | null
  purchase_from: string | null
  purchase_period: string | null
  calibration_cycle: string | null
  last_calibration_date: string | null
  next_calibration_date: string | null
  judgment_criteria: string | null
  status: string | null
  department: string | null
  datalink: string | null
  q_business: string | null
  validation_fm: string | null
  validation_qm: string | null
  remarks: string | null
  remarks2: string | null
}

const inputCls =
  'flex-1 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2.5 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)'

// JSONP helper - Apps Script 응답을 받기 위해 (CORS 우회 + 응답 확인)
function jsonpRequest<T>(baseUrl: string, params: URLSearchParams, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackName = 'instCb_' + Date.now() + '_' + Math.floor(Math.random() * 100000)
    const script = document.createElement('script')
    let timer: number
    const cleanup = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName]
      try { document.head.removeChild(script) } catch { /* noop */ }
      window.clearTimeout(timer)
    }
    ;(window as unknown as Record<string, (d: unknown) => void>)[callbackName] = (data) => {
      cleanup()
      resolve(data as T)
    }
    script.onerror = () => { cleanup(); reject(new Error('JSONP script load failed')) }
    timer = window.setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')) }, timeoutMs)
    params.set('callback', callbackName)
    script.src = `${baseUrl}?${params.toString()}`
    document.head.appendChild(script)
  })
}

// 시트 전체 row를 읽어옴 (Apps Script action=dump)
async function fetchSheetDump(): Promise<SheetInstrumentRow[]> {
  if (!SHEET_URL) throw new Error('SHEET_URL env var 미설정')
  const params = new URLSearchParams({ action: 'dump' })
  const res = await jsonpRequest<{ ok: boolean; error?: string; rows?: SheetInstrumentRow[] }>(SHEET_URL, params, 30000)
  if (!res.ok) throw new Error(res.error || '시트 dump 실패')
  return res.rows || []
}

// iframe fallback - 옛 SW가 cross-origin script tag를 가로채 JSONP 실패하는 환경 대응
// (차량 일지와 동일한 방식, 응답 확인은 불가하지만 시트 업데이트는 됨)
function iframeFireAndForget(saveUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    document.body.appendChild(iframe)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
      setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* noop */ } }, 500)
    }
    iframe.onload = finish
    iframe.onerror = finish
    iframe.src = saveUrl
    setTimeout(finish, 8000)
  })
}

// 시트의 '사용부서' 셀 업데이트 - JSONP 우선 → 실패 시 iframe fallback
async function updateSheetDepartment(payload: {
  instrument_no: string | null
  english_name: string | null
  model: string | null
  user_name: string
}): Promise<{ ok: boolean; error?: string; row?: number; fallback?: boolean }> {
  if (!SHEET_URL) return { ok: false, error: 'SHEET_URL env var 미설정' }
  const params = new URLSearchParams({
    action: 'use',
    instrument_no: payload.instrument_no || '',
    english_name: payload.english_name || '',
    model: payload.model || '',
    user_name: payload.user_name,
  })

  // 1차: JSONP (응답 확인 가능)
  try {
    const result = await jsonpRequest<{ ok: boolean; error?: string; row?: number }>(SHEET_URL, params)
    console.log('[instrument sheet] JSONP response:', result)
    return result
  } catch (err) {
    console.warn('[instrument sheet] JSONP failed, falling back to iframe:', err)
  }

  // 2차: iframe (응답 확인 불가, fire-and-forget) - 옛 PWA SW 환경 대응
  await iframeFireAndForget(`${SHEET_URL}?${params.toString()}`)
  return { ok: true, fallback: true }
}

const formatKoreanDate = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

const getPrimaryLabel = (i: Instrument): string =>
  i.name || i.english_name || i.model || i.instrument_no || '-'

const getSubLabel = (i: Instrument): string =>
  [i.english_name, i.model, i.serial_number].filter(Boolean).join(' · ')

// 계측기명(한글/영문) 또는 모델로만 검색 (관리번호는 제외)
async function searchByDisplay(q: string, limit = 10): Promise<Instrument[]> {
  const v = q.trim()
  if (!v) return []
  const esc = v.replace(/[%,]/g, '')
  const pattern = `%${esc}%`
  const { data, error } = await supabase
    .from('instruments')
    .select('*')
    .or(`name.ilike.${pattern},english_name.ilike.${pattern},model.ilike.${pattern}`)
    .limit(limit)
  if (error) {
    console.warn('[instrument search]', error)
    return []
  }
  return (data as Instrument[]) || []
}

// 자유 입력 매칭 (찾기 전용 — 관리번호까지 허용)
async function searchAll(q: string, limit = 20): Promise<Instrument[]> {
  const v = q.trim()
  if (!v) return []
  const esc = v.replace(/[%,]/g, '')
  const pattern = `%${esc}%`
  const { data, error } = await supabase
    .from('instruments')
    .select('*')
    .or(`name.ilike.${pattern},english_name.ilike.${pattern},model.ilike.${pattern},instrument_no.ilike.${pattern}`)
    .limit(limit)
  if (error) {
    console.warn('[instrument search]', error)
    return []
  }
  return (data as Instrument[]) || []
}

export default function InstrumentPage({ user }: Props) {
  /* ── 사용할 계측기 선택 ── */
  const [useInput, setUseInput] = useState('')
  const [useSuggestions, setUseSuggestions] = useState<Instrument[]>([])
  const [selectedUse, setSelectedUse] = useState<Instrument | null>(null)
  const [showUseList, setShowUseList] = useState(false)
  const [useMessage, setUseMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [useLoading, setUseLoading] = useState(false)

  /* ── 계측기 찾기 ── */
  const [findInput, setFindInput] = useState('')
  const [findSuggestions, setFindSuggestions] = useState<Instrument[]>([])
  const [selectedFind, setSelectedFind] = useState<Instrument | null>(null)
  const [showFindList, setShowFindList] = useState(false)
  const [findResult, setFindResult] = useState<
    | { kind: 'none' }
    | { kind: 'empty'; instrumentName: string; department: string | null }
    | { kind: 'usage'; usage: InstrumentUsage }
    | { kind: 'notfound' }
  >({ kind: 'none' })
  const [findLoading, setFindLoading] = useState(false)

  /* ── 시트 → DB 동기화 (품질팀 전용) ── */
  const canSync = SYNC_ALLOWED_EMAILS.has(user.email)
  const [syncing, setSyncing] = useState<null | 'cal' | 'dept' | 'status' | 'add'>(null)
  const [syncMessage, setSyncMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  /* ── 사용 자동완성 (debounce 200ms) ── */
  useEffect(() => {
    const v = useInput.trim()
    // 선택 상태에서 입력값이 바뀌면 선택 해제 (정확히 일치 강제)
    if (selectedUse && getPrimaryLabel(selectedUse) !== useInput) {
      setSelectedUse(null)
    }
    if (!v) { setUseSuggestions([]); setShowUseList(false); return }
    const t = setTimeout(async () => {
      const rows = await searchByDisplay(v, 10)
      setUseSuggestions(rows)
      setShowUseList(true)
    }, 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useInput])

  /* ── 찾기 자동완성 ── */
  useEffect(() => {
    const v = findInput.trim()
    // 선택 상태에서 입력값이 바뀌면 선택 해제 + 결과 초기화 (id 매칭 정확성 보장)
    if (selectedFind && getPrimaryLabel(selectedFind) !== findInput) {
      setSelectedFind(null)
      setFindResult({ kind: 'none' })
    }
    if (!v) { setFindSuggestions([]); setShowFindList(false); return }
    const t = setTimeout(async () => {
      const rows = await searchAll(v, 8)
      setFindSuggestions(rows)
      setShowFindList(true)
    }, 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findInput])

  /* ── 드롭다운에서 계측기 선택 ── */
  const selectInstrument = (i: Instrument) => {
    setSelectedUse(i)
    setUseInput(getPrimaryLabel(i))
    setShowUseList(false)
    setUseMessage(null)
  }

  const selectFindInstrument = (i: Instrument) => {
    setSelectedFind(i)
    setFindInput(getPrimaryLabel(i))
    setShowFindList(false)
    setFindResult({ kind: 'none' })
  }

  /* ── 사용 등록 ── */
  const handleUse = async () => {
    if (!selectedUse) {
      setUseMessage({ kind: 'error', text: '목록에서 계측기를 선택해 주세요.' })
      return
    }
    // 표시 라벨이 선택된 항목과 정확히 일치해야 진행 (입력 후 수정 방지 이중 안전장치)
    if (useInput.trim() !== getPrimaryLabel(selectedUse)) {
      setUseMessage({ kind: 'error', text: '선택한 항목과 입력값이 다릅니다. 다시 선택해 주세요.' })
      setSelectedUse(null)
      return
    }
    setUseLoading(true)
    setUseMessage(null)
    try {
      const payload: Partial<InstrumentUsage> = {
        instrument_id: selectedUse.id,
        instrument_no: selectedUse.instrument_no,
        name: selectedUse.name,
        english_name: selectedUse.english_name,
        model: selectedUse.model,
        user_id: user.id,
        user_name: user.name,
        date: toLocalDateStr(),
      }
      const { error } = await supabase.from('instrument_usages').insert(payload)
      if (error) {
        console.warn('[instrument_usages insert]', error)
        setUseMessage({ kind: 'error', text: '사용 등록 실패' })
        return
      }

      // Google Sheet '사용부서' 컬럼 업데이트 + 결과 확인
      const sheetRes = await updateSheetDepartment({
        instrument_no: selectedUse.instrument_no,
        english_name: selectedUse.english_name,
        model: selectedUse.model,
        user_name: user.name,
      })

      if (sheetRes.ok) {
        setUseMessage({ kind: 'success', text: `${getPrimaryLabel(selectedUse)} 사용 등록 완료` })
      } else {
        // DB는 들어갔지만 시트 업데이트는 실패 - 원인을 사용자에게 노출
        setUseMessage({ kind: 'error', text: `사용 등록은 됐지만 시트 업데이트 실패: ${sheetRes.error}` })
      }

      setUseInput('')
      setSelectedUse(null)
      setUseSuggestions([])
      setShowUseList(false)
    } finally {
      setUseLoading(false)
    }
  }

  /* ── 사용 중 찾기 ──
   * selectedFind(드롭다운에서 명시적 클릭한 row) 우선.
   * 같은 name을 가진 다른 instrument와 혼동되지 않게 id로 정확 매칭.
   * selectedFind가 없으면 instrument_no 정확 매칭 → 라벨 매칭 순으로 fallback. */
  const handleFind = async () => {
    const v = findInput.trim()
    if (!v && !selectedFind) { setFindResult({ kind: 'none' }); return }
    setFindLoading(true)
    try {
      let target: Instrument | null = selectedFind
      if (!target) {
        const rows = await searchAll(v, 20)
        const lower = v.toLowerCase()
        target =
          rows.find(r => r.instrument_no && r.instrument_no.toLowerCase() === lower) ||
          rows.find(r => [r.name, r.english_name, r.model]
            .filter(Boolean).map(s => String(s).toLowerCase()).includes(lower)
          ) || rows[0] || null
      }
      if (!target) { setFindResult({ kind: 'notfound' }); return }
      const { data, error } = await supabase
        .from('instrument_usages')
        .select('*')
        .eq('instrument_id', target.id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) {
        console.warn('[instrument_usages query]', error)
        setFindResult({ kind: 'notfound' })
        return
      }
      const usage = (data && data[0]) as InstrumentUsage | undefined
      if (!usage) {
        setFindResult({
          kind: 'empty',
          instrumentName: getPrimaryLabel(target),
          department: target.department ?? null,
        })
        return
      }
      setFindResult({ kind: 'usage', usage })
    } finally {
      setFindLoading(false)
    }
  }

  /* ── 시트 → DB 동기화 공통: 단일 필드 업데이트 (instrument_no 매칭) ── */
  const syncSingleField = async (
    fieldKey: 'last_calibration_date' | 'department' | 'status',
    label: string,
    sheetKey: keyof SheetInstrumentRow,
  ) => {
    setSyncMessage(null)
    try {
      const [sheetRows, dbRes] = await Promise.all([
        fetchSheetDump(),
        supabase.from('instruments').select(`id, instrument_no, ${fieldKey}`),
      ])
      if (dbRes.error) throw new Error(`DB 조회 실패: ${dbRes.error.message}`)
      const dbByNo = new Map<string, { id: string; value: string | null }>()
      for (const r of (dbRes.data || []) as unknown as Array<Record<string, string | null>>) {
        const no = r.instrument_no
        if (!no) continue
        dbByNo.set(no, { id: r.id as string, value: (r[fieldKey] as string | null) ?? null })
      }

      // 변경분 추출 (instrument_no가 시트/DB 양쪽에 있고 값이 다른 경우만)
      type Diff = { id: string; instrument_no: string; oldValue: string | null; newValue: string | null }
      const diffs: Diff[] = []
      let skippedNotInDb = 0
      for (const sheetRow of sheetRows) {
        const no = sheetRow.instrument_no
        if (!no) continue
        const dbRow = dbByNo.get(no)
        if (!dbRow) { skippedNotInDb++; continue }
        const newValue = (sheetRow[sheetKey] as string | null) ?? null
        if ((newValue || '') !== (dbRow.value || '')) {
          diffs.push({ id: dbRow.id, instrument_no: no, oldValue: dbRow.value, newValue })
        }
      }

      if (diffs.length === 0) {
        setSyncMessage({ kind: 'info', text: `${label}: 변경사항 없음 (시트 ${sheetRows.length}건 확인)` })
        return
      }

      // 순차 update (Supabase는 bulk update의 PK 매핑이 까다로워 row-by-row가 안전)
      let success = 0
      const failures: string[] = []
      for (const d of diffs) {
        const { error } = await supabase
          .from('instruments')
          .update({ [fieldKey]: d.newValue, updated_at: new Date().toISOString() })
          .eq('id', d.id)
        if (error) {
          console.warn(`[sync ${fieldKey}] ${d.instrument_no}:`, error)
          failures.push(d.instrument_no)
        } else {
          success++
        }
      }

      const parts = [`${label} ${success}건 업데이트`]
      if (failures.length) parts.push(`실패 ${failures.length}건 (${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '...' : ''})`)
      if (skippedNotInDb) parts.push(`DB에 없는 시트 row ${skippedNotInDb}건 무시`)
      setSyncMessage({
        kind: failures.length ? 'error' : 'success',
        text: parts.join(' · '),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[sync ${fieldKey}]`, err)
      setSyncMessage({ kind: 'error', text: `${label} 실패: ${msg}` })
    }
  }

  const handleSyncCalibration = async () => {
    if (syncing) return
    setSyncing('cal')
    try { await syncSingleField('last_calibration_date', '교정일자', 'last_calibration_date') }
    finally { setSyncing(null) }
  }

  const handleSyncDepartment = async () => {
    if (syncing) return
    setSyncing('dept')
    try { await syncSingleField('department', '사용부서', 'department') }
    finally { setSyncing(null) }
  }

  const handleSyncStatus = async () => {
    if (syncing) return
    setSyncing('status')
    try { await syncSingleField('status', '상태', 'status') }
    finally { setSyncing(null) }
  }

  /* ── 신규 계측기 INSERT (시트에 있고 DB에 없는 instrument_no) ── */
  const handleSyncAdd = async () => {
    if (syncing) return
    setSyncing('add')
    setSyncMessage(null)
    try {
      const [sheetRows, dbRes] = await Promise.all([
        fetchSheetDump(),
        supabase.from('instruments').select('instrument_no'),
      ])
      if (dbRes.error) throw new Error(`DB 조회 실패: ${dbRes.error.message}`)
      const dbNos = new Set<string>()
      for (const r of (dbRes.data || []) as Array<{ instrument_no: string | null }>) {
        if (r.instrument_no) dbNos.add(r.instrument_no)
      }

      // 시트에 있고 DB에 없는 row만 추출 (instrument_no 필수)
      const toInsert = sheetRows.filter(r => r.instrument_no && !dbNos.has(r.instrument_no))

      if (toInsert.length === 0) {
        setSyncMessage({ kind: 'info', text: `신규 계측기 없음 (시트 ${sheetRows.length}건 확인)` })
        return
      }

      // 시트 row → DB 컬럼 매핑 (purchase_price는 숫자로 변환)
      const payload = toInsert.map(r => ({
        instrument_no: r.instrument_no,
        name: r.name,
        english_name: r.english_name,
        model: r.model,
        serial_number: r.serial_number,
        manufacturer: r.manufacturer,
        specification: r.specification,
        purchase_price: r.purchase_price ? Number(String(r.purchase_price).replace(/[^0-9.-]/g, '')) || null : null,
        purchase_from: r.purchase_from,
        purchase_period: r.purchase_period,
        calibration_cycle: r.calibration_cycle,
        last_calibration_date: r.last_calibration_date,
        next_calibration_date: r.next_calibration_date,
        judgment_criteria: r.judgment_criteria,
        status: r.status,
        department: r.department,
        datalink: r.datalink,
        q_business: r.q_business,
        validation_fm: r.validation_fm,
        validation_qm: r.validation_qm,
        remarks: r.remarks,
        remarks2: r.remarks2,
      }))

      const { error } = await supabase.from('instruments').insert(payload)
      if (error) {
        console.warn('[sync add]', error)
        setSyncMessage({ kind: 'error', text: `신규 계측기 추가 실패: ${error.message}` })
        return
      }
      setSyncMessage({
        kind: 'success',
        text: `신규 계측기 ${toInsert.length}건 추가 (${toInsert.slice(0, 3).map(r => r.instrument_no).join(', ')}${toInsert.length > 3 ? '...' : ''})`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[sync add]', err)
      setSyncMessage({ kind: 'error', text: `신규 계측기 추가 실패: ${msg}` })
    } finally {
      setSyncing(null)
    }
  }

  /* ── 계측기 관리대장 시트 열기 ── */
  const handleOpenSheet = () => {
    if (!SHEET_VIEW_URL) {
      setUseMessage({ kind: 'error', text: '관리대장 시트 URL이 설정되지 않았습니다.' })
      return
    }
    window.open(SHEET_VIEW_URL, '_blank', 'noopener,noreferrer')
  }

  /* ── PullToRefresh ── */
  const refresh = useCallback(async () => {
    setUseMessage(null)
  }, [])
  const { refreshing, pullY, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(refresh, scrollRef)

  return (
    <div className="flex flex-col h-full" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <PullIndicator pullY={pullY} refreshing={refreshing} />

      {/* Header */}
      <div className="px-4 py-4 border-b border-(--color-border)">
        <h2 className="text-lg font-bold">계측기 관리</h2>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-24 px-4 space-y-4 pt-4">
        {/* 1. 사용할 계측기 선택 */}
        <section className="rounded-xl bg-(--color-surface) border border-(--color-border) p-4">
          <label className="block text-sm font-semibold mb-2 text-(--color-text)">사용할 계측기 선택</label>
          <input
            className={inputCls}
            value={useInput}
            onChange={e => setUseInput(e.target.value)}
            onFocus={() => { if (useSuggestions.length > 0 && !selectedUse) setShowUseList(true) }}
            placeholder="계측기명(한글/영문) 또는 모델"
          />
          <button
            onClick={handleUse}
            disabled={useLoading || !selectedUse || selectedUse.status !== '합격'}
            className="mt-2 w-full rounded-lg bg-(--color-primary) py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {useLoading ? '...' : '사용'}
          </button>

          {/* 자동완성 드롭다운 — 선택 안 된 상태에서만 표시 */}
          {showUseList && !selectedUse && useInput.trim() && (
            useSuggestions.length > 0 ? (
              <div className="mt-2 rounded-lg border border-(--color-border) bg-(--color-bg) max-h-80 overflow-y-auto">
                {useSuggestions.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => selectInstrument(s)}
                    className={`w-full px-3 py-2.5 text-left hover:bg-(--color-primary)/15 ${
                      idx % 2 === 0 ? 'bg-(--color-bg)' : 'bg-(--color-border)/15'
                    }`}
                  >
                    <div className="text-sm font-medium text-(--color-text) break-words">{getPrimaryLabel(s)}</div>
                    {getSubLabel(s) && (
                      <div className="text-xs text-(--color-text-secondary) break-words whitespace-normal mt-0.5">{getSubLabel(s)}</div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-(--color-text-secondary)">일치하는 계측기가 없습니다.</p>
            )
          )}

          {/* 선택된 항목 요약 — 관리번호 대신 기기번호로 식별 + status가 '합격' 이외면 사용불가 표시 */}
          {selectedUse && (
            <div className="mt-2 rounded-lg bg-(--color-primary)/10 px-3 py-2 text-xs text-(--color-text)">
              <span className="text-(--color-text-secondary)">선택됨 · </span>
              {[selectedUse.name, selectedUse.english_name, selectedUse.model, selectedUse.serial_number]
                .filter(Boolean).join(' · ')}
              {selectedUse.status !== '합격' && (
                <span className="ml-2 font-semibold text-red-500">사용불가</span>
              )}
            </div>
          )}

          {useMessage && (
            <p className={`mt-3 text-sm ${
              useMessage.kind === 'error' ? 'text-red-500' : 'text-(--color-primary)'
            }`}>
              {useMessage.text}
            </p>
          )}
        </section>

        {/* 2. 계측기 찾기 */}
        <section className="rounded-xl bg-(--color-surface) border border-(--color-border) p-4">
          <label className="block text-sm font-semibold mb-2 text-(--color-text)">계측기 찾기</label>
          <input
            className={inputCls}
            value={findInput}
            onChange={e => setFindInput(e.target.value)}
            onFocus={() => { if (findSuggestions.length > 0 && !selectedFind) setShowFindList(true) }}
            placeholder="계측기명 / 모델 / 관리번호"
            onKeyDown={e => { if (e.key === 'Enter') handleFind() }}
          />
          <button
            onClick={handleFind}
            disabled={findLoading}
            className="mt-2 w-full rounded-lg border border-(--color-border) py-2.5 text-sm font-medium text-(--color-text) disabled:opacity-50"
          >
            {findLoading ? '...' : '찾기'}
          </button>

          {/* 자동완성 드롭다운 — 선택 안 된 상태에서만 표시 */}
          {showFindList && !selectedFind && findInput.trim() && (
            findSuggestions.length > 0 ? (
              <div className="mt-2 rounded-lg border border-(--color-border) bg-(--color-bg) max-h-80 overflow-y-auto">
                {findSuggestions.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => selectFindInstrument(s)}
                    className={`w-full px-3 py-2.5 text-left hover:bg-(--color-primary)/15 ${
                      idx % 2 === 0 ? 'bg-(--color-bg)' : 'bg-(--color-border)/15'
                    }`}
                  >
                    <div className="text-sm font-medium text-(--color-text) break-words">{getPrimaryLabel(s)}</div>
                    {getSubLabel(s) && (
                      <div className="text-xs text-(--color-text-secondary) break-words whitespace-normal mt-0.5">{getSubLabel(s)}</div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-(--color-text-secondary)">일치하는 계측기가 없습니다.</p>
            )
          )}

          {/* 선택된 항목 요약 — 관리번호 대신 기기번호로 식별 + 사용불가 표시 */}
          {selectedFind && (
            <div className="mt-2 rounded-lg bg-(--color-primary)/10 px-3 py-2 text-xs text-(--color-text)">
              <span className="text-(--color-text-secondary)">선택됨 · </span>
              {[selectedFind.name, selectedFind.english_name, selectedFind.model, selectedFind.serial_number]
                .filter(Boolean).join(' · ')}
              {selectedFind.status !== '합격' && (
                <span className="ml-2 font-semibold text-red-500">사용불가</span>
              )}
            </div>
          )}

          {findResult.kind === 'usage' && (
            <p className="mt-3 text-sm text-(--color-text)">
              {formatKoreanDate(findResult.usage.date)} <strong>{findResult.usage.user_name}</strong>님이 사용중입니다.
            </p>
          )}
          {findResult.kind === 'empty' && (
            <p className="mt-3 text-sm text-(--color-text-secondary)">
              {findResult.instrumentName}
              {findResult.department
                ? <> — 사용부서: <strong className="text-(--color-text)">{findResult.department}</strong></>
                : ' — 사용 기록이 없습니다.'}
            </p>
          )}
          {findResult.kind === 'notfound' && (
            <p className="mt-3 text-sm text-red-500">일치하는 계측기를 찾지 못했습니다.</p>
          )}
        </section>

        {/* 3. 계측기 관리 대장 (시트 링크) */}
        <button
          onClick={handleOpenSheet}
          className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) py-3.5 text-sm font-semibold text-(--color-text) hover:bg-(--color-border)/40"
        >
          계측기 관리 대장
        </button>

        {/* 4. 시트 → DB 동기화 (품질팀 전용) */}
        {canSync && (
          <section className="rounded-xl bg-(--color-surface) border border-(--color-border) p-4">
            <div className="mb-3">
              <div className="text-sm font-semibold text-(--color-text)">시트 → DB 동기화</div>
              <div className="text-xs text-(--color-text-secondary) mt-0.5">품질팀 전용 · 관리번호 기준으로 비교</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleSyncCalibration}
                disabled={syncing !== null}
                className="rounded-lg border border-(--color-border) bg-(--color-bg) py-2.5 text-sm font-medium text-(--color-text) hover:bg-(--color-border)/40 disabled:opacity-50"
              >
                {syncing === 'cal' ? '...' : '교정일자 업데이트'}
              </button>
              <button
                onClick={handleSyncDepartment}
                disabled={syncing !== null}
                className="rounded-lg border border-(--color-border) bg-(--color-bg) py-2.5 text-sm font-medium text-(--color-text) hover:bg-(--color-border)/40 disabled:opacity-50"
              >
                {syncing === 'dept' ? '...' : '사용부서 업데이트'}
              </button>
              <button
                onClick={handleSyncStatus}
                disabled={syncing !== null}
                className="rounded-lg border border-(--color-border) bg-(--color-bg) py-2.5 text-sm font-medium text-(--color-text) hover:bg-(--color-border)/40 disabled:opacity-50"
              >
                {syncing === 'status' ? '...' : '상태 업데이트'}
              </button>
              <button
                onClick={handleSyncAdd}
                disabled={syncing !== null}
                className="rounded-lg border border-(--color-border) bg-(--color-bg) py-2.5 text-sm font-medium text-(--color-text) hover:bg-(--color-border)/40 disabled:opacity-50"
              >
                {syncing === 'add' ? '...' : '계측기 추가 업데이트'}
              </button>
            </div>
            {syncMessage && (
              <p className={`mt-3 text-sm ${
                syncMessage.kind === 'error' ? 'text-red-500'
                  : syncMessage.kind === 'success' ? 'text-(--color-primary)'
                  : 'text-(--color-text-secondary)'
              }`}>
                {syncMessage.text}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
