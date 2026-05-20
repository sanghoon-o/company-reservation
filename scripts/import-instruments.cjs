#!/usr/bin/env node
/**
 * 엑셀 '계측기 관리대장' → Supabase instruments 테이블 import
 *
 * 사용법:
 *   node scripts/import-instruments.js [엑셀파일경로]
 *   기본: data/계측기 관리대장.xlsx
 *
 * 옵션:
 *   --truncate : 실행 전 instruments 테이블의 모든 row 삭제
 */
const dotenv = require('dotenv')
const xlsx = require('xlsx')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

dotenv.config()

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').replace(/\s+/g, '')
const SUPABASE_KEY = (process.env.VITE_SUPABASE_ANON_KEY || '').replace(/\s+/g, '')
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const args = process.argv.slice(2)
const truncate = args.includes('--truncate')
const filePath = args.find(a => !a.startsWith('--')) || path.join('data', '계측기 관리대장.xlsx')

console.log(`📂 Reading: ${filePath}`)
const workbook = xlsx.readFile(filePath)
const SHEET_NAME = '계측기 관리대장'
if (!workbook.SheetNames.includes(SHEET_NAME)) {
  console.error(`Sheet "${SHEET_NAME}" not found. Available:`, workbook.SheetNames)
  process.exit(1)
}
const sheet = workbook.Sheets[SHEET_NAME]
const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null })

// 헤더는 row 3 (0-indexed), 데이터는 row 4부터
const HEADER_ROW = 3
const dataRows = aoa.slice(HEADER_ROW + 1)

// 열 인덱스 → DB 필드 매핑 (엑셀 헤더 순서)
const COLS = {
  0: 'no',                       // No
  1: 'instrument_no',            // 관리번호
  2: 'name',                     // 계측기명(한글)
  3: 'english_name',             // 계측기명(영문)
  4: 'model',                    // 모델명
  5: 'serial_number',            // 기기번호
  6: 'manufacturer',             // 제조사
  7: 'specification',            // 규격
  8: 'purchase_price',           // 구입가격
  9: 'purchase_from',            // 구입처
  10: 'purchase_period',         // 구입시기
  11: 'calibration_cycle',       // 교정주기
  12: 'last_calibration_date',   // 교정일자 (날짜 serial)
  13: 'next_calibration_date',   // 차기교정일자 (날짜 serial 또는 텍스트)
  14: 'judgment_criteria',       // 합격판정기준
  15: 'status',                  // 판정
  16: 'department',              // 사용부서
  17: 'datalink',                // Datalink
  18: 'q_business',              // Q사업 후속양산
  19: 'validation_fm',           // 검증 FM
  20: 'validation_qm',           // 검증 QM
  21: 'remarks',                 // 비고1
  22: 'remarks2',                // 비고2
}

// 엑셀 날짜 serial → ISO yyyy-mm-dd
function excelSerialToDate(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    // Excel epoch: 1899-12-30
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    if (!isNaN(d)) return d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    const m = v.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  return null
}

function cleanText(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' || s === '-' ? null : s
}

function toIntOrNull(v) {
  if (v == null || v === '') return null
  const n = parseInt(String(v).replace(/[^0-9\-]/g, ''), 10)
  return isNaN(n) ? null : n
}

function toNumberOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

const prepared = []
for (const row of dataRows) {
  if (!row) continue
  // 의미있는 값(계측기명 한/영, 모델, 관리번호) 중 하나라도 있어야 유효 행
  if (!row[1] && !row[2] && !row[3] && !row[4]) continue

  const out = {}
  for (const [idxStr, field] of Object.entries(COLS)) {
    const idx = Number(idxStr)
    const raw = row[idx]
    switch (field) {
      case 'no':
        out[field] = toIntOrNull(raw)
        break
      case 'purchase_price':
        out[field] = toNumberOrNull(raw)
        break
      case 'last_calibration_date':
        out[field] = excelSerialToDate(raw)
        break
      case 'next_calibration_date': {
        // 날짜 serial이면 yyyy-mm-dd, 아니면 텍스트 그대로 (렌탈/고장/분실)
        const asDate = excelSerialToDate(raw)
        out[field] = asDate || cleanText(raw)
        break
      }
      default:
        out[field] = cleanText(raw)
    }
  }
  prepared.push(out)
}

console.log(`📊 Parsed ${prepared.length} valid rows`)

async function run() {
  if (truncate) {
    console.log('🗑  Truncating instruments table...')
    const { error } = await supabase.from('instruments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      console.error('Truncate failed:', error)
      process.exit(1)
    }
  }

  console.log(`⬆  Uploading ${prepared.length} rows to instruments...`)
  const batchSize = 50
  for (let i = 0; i < prepared.length; i += batchSize) {
    const batch = prepared.slice(i, i + batchSize)
    const { error } = await supabase.from('instruments').insert(batch)
    if (error) {
      console.error(`❌ Insert error on batch ${i / batchSize + 1}:`, error)
      process.exit(1)
    }
    console.log(`  ✓ batch ${i / batchSize + 1}: ${batch.length} rows`)
  }
  console.log('✅ Done.')
}

run().catch(err => { console.error(err); process.exit(1) })
