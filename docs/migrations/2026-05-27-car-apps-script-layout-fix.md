# 차량 Apps Script 패치 — 시트 컬럼 재배치 대응 (구분 K → B)

기존 패치(2026-05-21)는 `구분` 컬럼을 맨 끝(K)에 두는 전제였으나, 실제 시트에서는 `구분`이 B(2번째)로 이동하면서 모든 컬럼이 한 칸씩 오른쪽으로 밀렸음. 이에 맞춰 Apps Script의 컬럼 인덱스를 새로 매핑.

## 현재 시트 컬럼 구조 (헤더 기준)

| 열 | 인덱스 | 내용 |
|----|---|------|
| A  | 0 | 사용일자(요일) |
| B  | 1 | 구분 (오전/오후/종일) |
| C  | 2 | 부서 |
| D  | 3 | 성명 |
| E  | 4 | 차종 |
| F  | 5 | 주행 전 |
| G  | 6 | 주행 후 |
| H  | 7 | 주행거리 |
| I  | 8 | 출/퇴근용 |
| J  | 9 | 일반 업무용 |
| K  | 10 | 비고 |

## 증상

- 일지 작성 모달에서 "주행 전 km" 자동 조회 실패
- `last_odo` 조회가 `data[i][3]`(현재=성명)을 차종으로 보고 매칭, `data[i][5]`(현재=주행전)를 odo_after로 읽음
- `query` 조회도 동일한 인덱스 어긋남으로 row 매칭 실패

## 적용

Apps Script 편집기에서 기존 코드 전체 삭제 → 아래 코드 붙여넣기 → 저장 → 배포 → 새 버전 배포 (URL 유지).

```javascript
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
    const p = e.parameter

    // 컬럼 인덱스 (현재 시트 구조에 고정)
    const COL_DATE = 0      // A: 사용일자
    const COL_PERIOD = 1    // B: 구분
    const COL_DEPT = 2      // C: 부서
    const COL_NAME = 3      // D: 성명
    const COL_CAR = 4       // E: 차종
    const COL_ODO_BEFORE = 5  // F: 주행 전
    const COL_ODO_AFTER = 6   // G: 주행 후
    const COL_DISTANCE = 7  // H: 주행거리
    const COL_COMMUTE = 8   // I: 출/퇴근용
    const COL_BUSINESS = 9  // J: 일반 업무용
    const COL_NOTE = 10     // K: 비고

    const period = p.period || 'full'
    const periodLabel = period === 'am' ? '오전' : period === 'pm' ? '오후' : '종일'

    function findRow(data, dateValue, userName, carName) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][COL_DATE]) === dateValue &&
            String(data[i][COL_NAME]) === userName &&
            String(data[i][COL_CAR]) === carName) {
          const rowPeriod = String(data[i][COL_PERIOD] || '종일').trim()
          if (rowPeriod !== periodLabel) continue
          return i
        }
      }
      return -1
    }

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

    // ===== 조회 모드 =====
    if (p.action === 'query') {
      const dateValue = p.date || ''
      const userName = p.user_name || ''
      const carName = p.car_name || ''
      const data = sheet.getDataRange().getValues()
      const idx = findRow(data, dateValue, userName, carName)

      let found = null
      if (idx >= 0) {
        found = {
          date: data[idx][COL_DATE],
          period: String(data[idx][COL_PERIOD] || '종일'),
          department: data[idx][COL_DEPT],
          user_name: data[idx][COL_NAME],
          car_name: data[idx][COL_CAR],
          odo_before: data[idx][COL_ODO_BEFORE],
          odo_after: data[idx][COL_ODO_AFTER],
          distance: data[idx][COL_DISTANCE],
          commute_distance: data[idx][COL_COMMUTE],
          business_distance: data[idx][COL_BUSINESS],
          note: data[idx][COL_NOTE],
        }
      }
      return jsonpWrap({ ok: true, data: found })
    }

    // ===== 같은 차종 최근 odo_after =====
    if (p.action === 'last_odo') {
      const carName = p.car_name || ''
      const data = sheet.getDataRange().getValues()
      let bestIdx = -1
      let bestTs = -1
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][COL_CAR]) !== carName) continue
        const odoAfter = data[i][COL_ODO_AFTER]
        if (odoAfter === '' || odoAfter == null) continue
        const ts = parseSheetDate(data[i][COL_DATE])
        if (ts > bestTs) {
          bestTs = ts
          bestIdx = i
        }
      }
      let found = null
      if (bestIdx >= 0) {
        found = {
          date: data[bestIdx][COL_DATE],
          car_name: data[bestIdx][COL_CAR],
          odo_after: data[bestIdx][COL_ODO_AFTER],
        }
      }
      return jsonpWrap({ ok: true, data: found })
    }

    // ===== 저장 모드 (upsert by 날짜+성명+차종+구분) =====
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

    // newRow는 현재 시트 컬럼 순서대로
    const newRow = [
      dateValue,    // A
      periodLabel,  // B
      department,   // C
      userName,     // D
      carName,      // E
      odoBefore,    // F
      odoAfter,     // G
      distance,     // H
      commute,      // I
      business,     // J
      note,         // K
    ]

    const data = sheet.getDataRange().getValues()
    const idx = findRow(data, dateValue, userName, carName)

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

## 재배포

1. Apps Script 편집기 → 배포 → 배포 관리
2. 활성 배포 우측 연필(편집) → 버전: "새 버전" 선택 → 배포
3. URL은 그대로 유지됨 (Vercel env 수정 불필요)

## 동작 확인

1. 일지 작성 모달 열기 → 같은 차종 최근 row의 `주행 후` 값이 `주행 전 (km)` 칸에 자동 표시됨
2. 같은 (날짜+성명+차종+구분) row가 시트에 있으면 모든 입력값이 자동 채워짐
3. 저장 시 `구분`은 B, `부서`는 C, `성명`은 D, `차종`은 E에 위치
