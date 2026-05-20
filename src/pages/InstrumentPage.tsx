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

const inputCls =
  'flex-1 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2.5 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)'

// JSONP helper - Apps Script 응답을 받기 위해 (CORS 우회 + 응답 확인)
function jsonpRequest(baseUrl: string, params: URLSearchParams, timeoutMs = 10000): Promise<{ ok: boolean; error?: string; row?: number }> {
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
      resolve(data as { ok: boolean; error?: string; row?: number })
    }
    script.onerror = () => { cleanup(); reject(new Error('JSONP script load failed')) }
    timer = window.setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')) }, timeoutMs)
    params.set('callback', callbackName)
    script.src = `${baseUrl}?${params.toString()}`
    document.head.appendChild(script)
  })
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
    const result = await jsonpRequest(SHEET_URL, params)
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
  [i.english_name, i.model, i.instrument_no].filter(Boolean).join(' · ')

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
  const [findResult, setFindResult] = useState<
    | { kind: 'none' }
    | { kind: 'empty'; instrumentName: string }
    | { kind: 'usage'; usage: InstrumentUsage }
    | { kind: 'notfound' }
  >({ kind: 'none' })
  const [findLoading, setFindLoading] = useState(false)

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
    if (!v) { setFindSuggestions([]); return }
    const t = setTimeout(() => searchAll(v, 8).then(setFindSuggestions), 200)
    return () => clearTimeout(t)
  }, [findInput])

  /* ── 드롭다운에서 계측기 선택 ── */
  const selectInstrument = (i: Instrument) => {
    setSelectedUse(i)
    setUseInput(getPrimaryLabel(i))
    setShowUseList(false)
    setUseMessage(null)
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

  /* ── 사용 중 찾기 ── */
  const handleFind = async () => {
    const v = findInput.trim()
    if (!v) { setFindResult({ kind: 'none' }); return }
    setFindLoading(true)
    try {
      const rows = await searchAll(v, 20)
      const lower = v.toLowerCase()
      const target =
        rows.find(r => [r.name, r.english_name, r.model, r.instrument_no]
          .filter(Boolean).map(s => String(s).toLowerCase()).includes(lower)
        ) || rows[0] || null
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
        setFindResult({ kind: 'empty', instrumentName: getPrimaryLabel(target) })
        return
      }
      setFindResult({ kind: 'usage', usage })
    } finally {
      setFindLoading(false)
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
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              value={useInput}
              onChange={e => setUseInput(e.target.value)}
              onFocus={() => { if (useSuggestions.length > 0 && !selectedUse) setShowUseList(true) }}
              placeholder="계측기명(한글/영문) 또는 모델"
            />
            <button
              onClick={handleUse}
              disabled={useLoading || !selectedUse}
              className="rounded-lg bg-(--color-primary) px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {useLoading ? '...' : '사용'}
            </button>
          </div>

          {/* 자동완성 드롭다운 — 선택 안 된 상태에서만 표시 */}
          {showUseList && !selectedUse && useInput.trim() && (
            useSuggestions.length > 0 ? (
              <div className="mt-2 rounded-lg border border-(--color-border) bg-(--color-bg) max-h-64 overflow-y-auto divide-y divide-(--color-border)">
                {useSuggestions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => selectInstrument(s)}
                    className="w-full px-3 py-2 text-left hover:bg-(--color-border)/40"
                  >
                    <div className="text-sm font-medium text-(--color-text)">{getPrimaryLabel(s)}</div>
                    {getSubLabel(s) && (
                      <div className="text-xs text-(--color-text-secondary) truncate">{getSubLabel(s)}</div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-(--color-text-secondary)">일치하는 계측기가 없습니다.</p>
            )
          )}

          {/* 선택된 항목 요약 */}
          {selectedUse && (
            <div className="mt-2 rounded-lg bg-(--color-primary)/10 px-3 py-2 text-xs text-(--color-text)">
              <span className="text-(--color-text-secondary)">선택됨 · </span>
              {[selectedUse.name, selectedUse.english_name, selectedUse.model, selectedUse.instrument_no]
                .filter(Boolean).join(' · ')}
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
          <div className="flex items-center gap-2">
            <input
              list="instrument-find-options"
              className={inputCls}
              value={findInput}
              onChange={e => setFindInput(e.target.value)}
              placeholder="계측기명 / 모델 / 관리번호"
              onKeyDown={e => { if (e.key === 'Enter') handleFind() }}
            />
            <datalist id="instrument-find-options">
              {findSuggestions.map(s => {
                const label = [s.name, s.english_name, s.model, s.instrument_no].filter(Boolean).join(' · ')
                const value = s.name || s.english_name || s.model || s.instrument_no || ''
                return <option key={s.id} value={value}>{label}</option>
              })}
            </datalist>
            <button
              onClick={handleFind}
              disabled={findLoading}
              className="rounded-lg border border-(--color-border) px-4 py-2.5 text-sm font-medium text-(--color-text) disabled:opacity-50"
            >
              {findLoading ? '...' : '찾기'}
            </button>
          </div>
          {findResult.kind === 'usage' && (
            <p className="mt-3 text-sm text-(--color-text)">
              {formatKoreanDate(findResult.usage.date)} <strong>{findResult.usage.user_name}</strong>님이 사용중입니다.
            </p>
          )}
          {findResult.kind === 'empty' && (
            <p className="mt-3 text-sm text-(--color-text-secondary)">
              {findResult.instrumentName} — 사용 기록이 없습니다.
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
      </div>
    </div>
  )
}
