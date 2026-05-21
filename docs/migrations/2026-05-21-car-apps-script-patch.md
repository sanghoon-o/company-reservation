# 차량 Apps Script 패치 — 시간대(period) 지원

차량 예약에 오전/오후/종일(`period`) 도입에 따라 차량 일지 시트의 Apps Script를 교체합니다.

## 적용 순서

### 1. 시트 준비
- 차량 일지 시트 **맨 오른쪽 끝**에 새 컬럼 추가 → 헤더 셀에 정확히 `구분` 입력
- 기존 모든 row의 `구분` 셀에 `종일` 채워두기

### 2. Apps Script 코드 교체
시트 → 확장 프로그램 → Apps Script 편집기 → 기존 코드 전체 삭제 → 아래 코드 붙여넣기 → 저장.

```javascript
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
    const p = e.parameter

    // period 파라미터: 'am' | 'pm' | 'full' → 시트 표시값: '오전' | '오후' | '종일'
    const period = p.period || 'full'
    const periodLabel = period === 'am' ? '오전' : period === 'pm' ? '오후' : '종일'

    // 헤더에서 '구분' 컬럼 인덱스 찾기 (못 찾으면 -1 → 기존 3-key 동작)
    function getColPeriod(data) {
      if (!data || !data[0]) return -1
      const headers = data[0].map(h => String(h || '').trim())
      return headers.indexOf('구분')
    }

    // (date + user_name + car_name) 3-key 또는 (+ period) 4-key 매칭
    function findRow(data, colPeriod, dateValue, userName, carName) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === dateValue &&
            String(data[i][2]) === userName &&
            String(data[i][3]) === carName) {
          if (colPeriod >= 0) {
            const rowPeriod = String(data[i][colPeriod] || '종일').trim()
            if (rowPeriod !== periodLabel) continue
          }
          return i
        }
      }
      return -1
    }

    // "2026.4.8 (수)" → timestamp (요일/공백 무시)
    function parseSheetDate(s) {
      if (s == null) return 0
      const m = String(s).match(/(\d+)\.(\d+)\.(\d+)/)
      if (!m) return 0
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
    }

    function jsonpWrap(obj) {
      const json = JSON.stringify(obj)
      if (p.callback) {
        return ContentService.createTextOutput(p.callback + '(' + json + ')')
          .setMimeType(ContentService.MimeType.JAVASCRIPT)
      }
      return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON)
    }

    // ===== 조회 모드 (READ ONLY, insert 절대 안 함) =====
    if (p.action === 'query') {
      const dateValue = p.date || ''
      const userName = p.user_name || ''
      const carName = p.car_name || ''
      const data = sheet.getDataRange().getValues()
      const colPeriod = getColPeriod(data)
      const idx = findRow(data, colPeriod, dateValue, userName, carName)

      let found = null
      if (idx >= 0) {
        found = {
          date: data[idx][0],
          department: data[idx][1],
          user_name: data[idx][2],
          car_name: data[idx][3],
          odo_before: data[idx][4],
          odo_after: data[idx][5],
          distance: data[idx][6],
          commute_distance: data[idx][7],
          business_distance: data[idx][8],
          note: data[idx][9],
          period: colPeriod >= 0 ? String(data[idx][colPeriod] || '종일') : '종일',
        }
      }
      return jsonpWrap({ ok: true, data: found })
    }

    // ===== 같은 차종에서 사용일자가 가장 최근인 row의 odo_after 조회 (period 무관) =====
    if (p.action === 'last_odo') {
      const carName = p.car_name || ''
      const data = sheet.getDataRange().getValues()
      let bestIdx = -1
      let bestTs = -1
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][3]) !== carName) continue
        const odoAfter = data[i][5]
        if (odoAfter === '' || odoAfter == null) continue
        const ts = parseSheetDate(data[i][0])
        if (ts > bestTs) {
          bestTs = ts
          bestIdx = i
        }
      }
      let found = null
      if (bestIdx >= 0) {
        found = {
          date: data[bestIdx][0],
          car_name: data[bestIdx][3],
          odo_after: data[bestIdx][5],
        }
      }
      return jsonpWrap({ ok: true, data: found })
    }

    // ===== 저장 모드 (upsert by 날짜+이름+차종+구분) =====
    const dateValue = p.date || ''
    const department = p.department || ''
    const userName = p.user_name || ''
    const carName = p.car_name || ''
    const odoBefore = p.odo_before ? Number(p.odo_before) : ''
    const odoAfter = p.odo_after ? Number(p.odo_after) : ''
    const distance = p.distance ? Number(p.distance) : ''
    const commute = p.commute_distance ? Number(p.commute_distance) : ''
    const business = p.business_distance ? Number(p.business_distance) : ''
    const note = p.note || ''

    const data = sheet.getDataRange().getValues()
    const colPeriod = getColPeriod(data)

    // 기본 row: 기존 10개 컬럼
    const newRow = [dateValue, department, userName, carName, odoBefore, odoAfter, distance,
      commute, business, note]
    // '구분' 컬럼이 있으면 그 인덱스 위치에 periodLabel 추가 (헤더가 맨 끝에 있다고 가정)
    if (colPeriod >= 0) {
      while (newRow.length <= colPeriod) newRow.push('')
      newRow[colPeriod] = periodLabel
    }

    const idx = findRow(data, colPeriod, dateValue, userName, carName)

    if (idx >= 0) {
      sheet.getRange(idx + 1, 1, 1, newRow.length).setValues([newRow])
    } else {
      sheet.appendRow(newRow)
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON)
  }
}
```

### 3. 재배포
- 배포 → 배포 관리 → 활성 배포 우측 연필 → "새 버전" 선택 → 배포
- deployment URL은 그대로 유지됨 (Vercel env 수정 불필요)

## 동작 확인

배포 후 앱에서:
1. 차량을 오전만 예약 → 일지 작성 → 시트에 `구분=오전` row 추가
2. 같은 사람이 같은 날 같은 차량을 오후로도 추가 예약 → 일지 작성 → 시트에 `구분=오후` row가 별도로 추가 (덮어쓰기 X)
3. 종일 예약 후 일지 작성 → `구분=종일` row 생성

## 호환성

- **'구분' 컬럼이 시트에 없으면** → 기존 3-key(date + user + car) 동작으로 자동 fallback
- **시트 컬럼을 맨 끝이 아닌 다른 위치에 추가하면** → newRow 인덱스가 어긋날 수 있음. 반드시 **맨 끝**에 추가하세요
