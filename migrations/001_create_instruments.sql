-- Migration: create instruments and instrument_usages tables
-- Supabase SQL Editor 또는 권한 있는 psql 세션에서 실행

-- instruments table (계측기 관리대장)
CREATE TABLE IF NOT EXISTS instruments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  no INTEGER,                        -- 엑셀 No (순번)
  instrument_no TEXT,                -- 관리번호 (EDEL-M-001 등)
  name TEXT,                         -- 계측기명(한글)
  english_name TEXT,                 -- 계측기명(영문)
  model TEXT,                        -- 모델명
  serial_number TEXT,                -- 기기번호
  manufacturer TEXT,                 -- 제조사
  specification TEXT,                -- 규격
  purchase_price NUMERIC,            -- 구입가격
  purchase_from TEXT,                -- 구입처
  purchase_period TEXT,              -- 구입시기 (혼합형태)
  calibration_cycle TEXT,            -- 교정주기 (1Y 등)
  last_calibration_date DATE,        -- 교정일자
  next_calibration_date TEXT,        -- 차기교정일자 (날짜/렌탈/고장/분실)
  judgment_criteria TEXT,            -- 합격판정기준
  status TEXT,                       -- 판정
  department TEXT,                   -- 사용부서
  datalink TEXT,                     -- Datalink
  q_business TEXT,                   -- Q사업 후속양산
  validation_fm TEXT,                -- 검증 FM
  validation_qm TEXT,                -- 검증 QM
  remarks TEXT,                      -- 비고1
  remarks2 TEXT,                     -- 비고2
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instruments_instrument_no ON instruments(instrument_no);
CREATE INDEX IF NOT EXISTS idx_instruments_serial ON instruments(serial_number);
CREATE INDEX IF NOT EXISTS idx_instruments_name ON instruments(name);
CREATE INDEX IF NOT EXISTS idx_instruments_english_name ON instruments(english_name);
CREATE INDEX IF NOT EXISTS idx_instruments_model ON instruments(model);

ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to instruments" ON instruments
  FOR ALL USING (true) WITH CHECK (true);

-- instrument_usages table (사용 이력)
CREATE TABLE IF NOT EXISTS instrument_usages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instrument_id UUID REFERENCES instruments(id) ON DELETE SET NULL,
  instrument_no TEXT,
  name TEXT,
  english_name TEXT,
  model TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instrument_usages_date ON instrument_usages(date);
CREATE INDEX IF NOT EXISTS idx_instrument_usages_instrument ON instrument_usages(instrument_id, created_at DESC);

ALTER TABLE instrument_usages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to instrument_usages" ON instrument_usages
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE instruments;
ALTER PUBLICATION supabase_realtime ADD TABLE instrument_usages;
