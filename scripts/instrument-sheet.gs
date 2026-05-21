/**
 * 계측기 관리대장 - Google Apps Script
 *
 * 설정:
 *  1. 구글시트 → 확장 프로그램 → Apps Script
 *  2. 이 파일 전체 코드를 붙여넣고 저장
 *  3. 배포 → 새 배포 → 유형: 웹 앱
 *     - 실행 권한: "나"
 *     - 액세스 권한: "모든 사용자"
 *  4. /exec URL을 VITE_GOOGLE_SHEET_INSTRUMENT_URL에 입력 (.env 및 Vercel)
 *     시트 보기 링크는 VITE_GOOGLE_SHEET_VIEW_INSTRUMENT_URL에 입력
 *
 * 시트 요구사항:
 *  - 시트 이름: '계측기 관리대장'
 *  - 어딘가 한 row에 헤더가 있어야 함 (특히 '관리번호'와 '사용부서' 컬럼 필수)
 *  - 헤더명: 관리번호 / 계측기명(영문) / 모델명 / 사용부서 (정확 일치)
 */

var SHEET_NAME = '계측기 관리대장'

function doGet(e) {
  var action = (e.parameter.action || '').toString()
  try {
    if (action === 'use') {
      var result = recordUsage(e.parameter)
      return jsonResponse_(e, { ok: true, action: 'use', row: result.row })
    }
    if (action === 'dump') {
      var rows = dumpInstruments()
      return jsonResponse_(e, { ok: true, action: 'dump', rows: rows })
    }
    if (action === 'query') {
      return jsonResponse_(e, { ok: true, status: 'ready' })
    }
    return jsonResponse_(e, { ok: true, status: 'ready', help: 'use action=use|dump' })
  } catch (err) {
    return jsonResponse_(e, { ok: false, error: String(err && err.message || err) })
  }
}

function doPost(e) {
  // GET과 동일하게 처리 (iframe POST 호환)
  e.parameter = e.parameter || {}
  if (e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents)
      for (var k in body) e.parameter[k] = body[k]
    } catch (_) { /* form-urlencoded는 e.parameter에 이미 들어옴 */ }
  }
  return doGet(e)
}

function jsonResponse_(e, obj) {
  var text = JSON.stringify(obj)
  var callback = e && e.parameter && e.parameter.callback
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT)
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON)
}

function recordUsage(p) {
  var ss = SpreadsheetApp.getActive()

  // 1차: 지정된 이름의 시트 시도
  var sheet = ss.getSheetByName(SHEET_NAME)
  var values = null
  var headerRowIdx = -1
  var colIdx = {}

  function tryFindHeader(sh) {
    var v = sh.getDataRange().getValues()
    for (var i = 0; i < Math.min(v.length, 30); i++) {
      var cells = v[i].map(function (c) { return String(c == null ? '' : c).trim() })
      if (cells.indexOf('관리번호') >= 0) {
        var ci = {}
        cells.forEach(function (h, j) { if (h) ci[h] = j })
        return { values: v, headerRowIdx: i, colIdx: ci }
      }
    }
    return null
  }

  if (sheet) {
    var r = tryFindHeader(sheet)
    if (r) { values = r.values; headerRowIdx = r.headerRowIdx; colIdx = r.colIdx }
  }

  // 2차: 못 찾으면 모든 시트 순회하면서 '관리번호' 헤더 있는 시트 찾기
  if (!values) {
    var sheets = ss.getSheets()
    for (var s = 0; s < sheets.length; s++) {
      var r2 = tryFindHeader(sheets[s])
      if (r2) {
        sheet = sheets[s]
        values = r2.values; headerRowIdx = r2.headerRowIdx; colIdx = r2.colIdx
        break
      }
    }
  }

  if (!values) {
    var names = ss.getSheets().map(function (sh) { return sh.getName() }).join(', ')
    throw new Error('시트 "' + SHEET_NAME + '" 또는 "관리번호" 헤더가 있는 시트를 찾을 수 없음. 현재 시트들: ' + names)
  }

  var COL_NO = colIdx['관리번호']
  var COL_EN = colIdx['계측기명(영문)']
  var COL_MODEL = colIdx['모델명']
  var COL_DEPT = colIdx['사용부서']
  if (COL_DEPT == null) throw new Error('사용부서 컬럼 헤더를 찾을 수 없음')

  var instrument_no = String(p.instrument_no || '').trim()
  var english_name = String(p.english_name || '').trim()
  var model = String(p.model || '').trim()
  var user_name = String(p.user_name || '').trim()
  if (!user_name) throw new Error('user_name 누락')

  // 매칭: 1) 관리번호 정확 일치 우선, 2) 없으면 (영문명 + 모델) 일치
  var targetRow = -1
  for (var r = headerRowIdx + 1; r < values.length; r++) {
    var row = values[r]
    if (instrument_no && String(row[COL_NO] || '').trim() === instrument_no) {
      targetRow = r
      break
    }
  }
  if (targetRow < 0 && !instrument_no && english_name && model) {
    for (var r2 = headerRowIdx + 1; r2 < values.length; r2++) {
      var row2 = values[r2]
      if (
        String(row2[COL_EN] || '').trim() === english_name &&
        String(row2[COL_MODEL] || '').trim() === model
      ) {
        targetRow = r2
        break
      }
    }
  }
  if (targetRow < 0) throw new Error('일치하는 계측기 row 없음')

  // 사용부서 셀 업데이트 (1-indexed)
  sheet.getRange(targetRow + 1, COL_DEPT + 1).setValue(user_name)
  return { row: targetRow + 1 }
}

// 시트 전체 row를 JSON으로 반환 (시트 → DB 동기화용)
// 클라이언트가 instrument_no 기준으로 DB와 비교하여 UPDATE/INSERT 처리
function dumpInstruments() {
  var ss = SpreadsheetApp.getActive()
  var sheet = ss.getSheetByName(SHEET_NAME)
  var found = null

  function tryFindHeader(sh) {
    var v = sh.getDataRange().getValues()
    for (var i = 0; i < Math.min(v.length, 30); i++) {
      var cells = v[i].map(function (c) { return String(c == null ? '' : c).trim() })
      if (cells.indexOf('관리번호') >= 0) {
        var ci = {}
        cells.forEach(function (h, j) { if (h) ci[h] = j })
        return { values: v, headerRowIdx: i, colIdx: ci }
      }
    }
    return null
  }

  if (sheet) found = tryFindHeader(sheet)
  if (!found) {
    var sheets = ss.getSheets()
    for (var s = 0; s < sheets.length; s++) {
      var r = tryFindHeader(sheets[s])
      if (r) { found = r; break }
    }
  }
  if (!found) throw new Error('"관리번호" 헤더가 있는 시트를 찾을 수 없음')

  var values = found.values, headerRowIdx = found.headerRowIdx, colIdx = found.colIdx
  var COL_NO = colIdx['관리번호']
  var COL_NAME_KO = colIdx['계측기명(한글)']
  var COL_NAME_EN = colIdx['계측기명(영문)']
  var COL_MODEL = colIdx['모델명']
  var COL_SERIAL = colIdx['기기번호']
  var COL_MAKER = colIdx['제조사']
  var COL_SPEC = colIdx['규격']
  var COL_PRICE = colIdx['구입가격']
  var COL_PURCHASE_FROM = colIdx['구입처']
  var COL_PURCHASE_PERIOD = colIdx['구입시기']
  var COL_CYCLE = colIdx['교정주기']
  var COL_LAST_CAL = colIdx['교정일자']
  var COL_NEXT_CAL = colIdx['차기교정일자']
  var COL_CRITERIA = colIdx['합격판정기준']
  var COL_STATUS = colIdx['판정']
  var COL_DEPT = colIdx['사용부서']
  var COL_DATALINK = colIdx['Datalink']
  var COL_Q = colIdx['Q사업 후속양산']
  var COL_VAL_FM = colIdx['검증 FM']
  var COL_VAL_QM = colIdx['검증 QM']
  var COL_REMARKS = colIdx['비고1']
  var COL_REMARKS2 = colIdx['비고2']

  function cellText(row, c) {
    if (c == null) return null
    var v = row[c]
    if (v == null) return null
    var s = (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v).trim()
    return (s === '' || s === '-') ? null : s
  }
  function cellDate(row, c) {
    if (c == null) return null
    var v = row[c]
    if (v == null || v === '') return null
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd')
    var s = String(v).trim()
    var m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)
    return null
  }
  function cellDateOrText(row, c) {
    var d = cellDate(row, c)
    if (d) return d
    return cellText(row, c)
  }

  var out = []
  for (var r = headerRowIdx + 1; r < values.length; r++) {
    var row = values[r]
    var no = cellText(row, COL_NO)
    var nameKo = cellText(row, COL_NAME_KO)
    var nameEn = cellText(row, COL_NAME_EN)
    var model = cellText(row, COL_MODEL)
    if (!no && !nameKo && !nameEn && !model) continue  // 빈 행 skip

    out.push({
      instrument_no: no,
      name: nameKo,
      english_name: nameEn,
      model: model,
      serial_number: cellText(row, COL_SERIAL),
      manufacturer: cellText(row, COL_MAKER),
      specification: cellText(row, COL_SPEC),
      purchase_price: cellText(row, COL_PRICE),
      purchase_from: cellText(row, COL_PURCHASE_FROM),
      purchase_period: cellText(row, COL_PURCHASE_PERIOD),
      calibration_cycle: cellText(row, COL_CYCLE),
      last_calibration_date: cellDate(row, COL_LAST_CAL),
      next_calibration_date: cellDateOrText(row, COL_NEXT_CAL),
      judgment_criteria: cellText(row, COL_CRITERIA),
      status: cellText(row, COL_STATUS),
      department: cellText(row, COL_DEPT),
      datalink: cellText(row, COL_DATALINK),
      q_business: cellText(row, COL_Q),
      validation_fm: cellText(row, COL_VAL_FM),
      validation_qm: cellText(row, COL_VAL_QM),
      remarks: cellText(row, COL_REMARKS),
      remarks2: cellText(row, COL_REMARKS2),
    })
  }
  return out
}
