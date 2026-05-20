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
    if (action === 'query') {
      return jsonResponse_(e, { ok: true, status: 'ready' })
    }
    return jsonResponse_(e, { ok: true, status: 'ready', help: 'use action=use with params instrument_no, english_name, model, user_name' })
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
