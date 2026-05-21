-- =============================================
-- 사내 통합 예약 시스템 - Supabase 테이블 설정 SQL
-- Supabase SQL Editor에서 실행하세요
-- =============================================

-- 1. users 테이블
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. car_reservations 테이블
CREATE TABLE IF NOT EXISTS car_reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  car_name TEXT NOT NULL,
  date DATE NOT NULL,
  period TEXT NOT NULL DEFAULT 'full' CHECK (period IN ('am', 'pm', 'full')),
  destination TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. room_reservations 테이블
CREATE TABLE IF NOT EXISTS room_reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('meeting_room', 'chamber')),
  resource_name TEXT NOT NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. car_logs 테이블 (차량 일지)
CREATE TABLE IF NOT EXISTS car_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id UUID REFERENCES car_reservations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  car_name TEXT NOT NULL,
  date DATE NOT NULL,
  department TEXT,
  odo_before NUMERIC,
  odo_after NUMERIC,
  distance NUMERIC,
  commute_distance NUMERIC,
  business_distance NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. instruments 테이블 (계측기 관리대장)
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
  purchase_period TEXT,              -- 구입시기 (혼합형태: 날짜/연도 텍스트)
  calibration_cycle TEXT,            -- 교정주기 (1Y 등)
  last_calibration_date DATE,        -- 교정일자
  next_calibration_date TEXT,        -- 차기교정일자 (날짜 또는 렌탈/고장/분실)
  judgment_criteria TEXT,            -- 합격판정기준
  status TEXT,                       -- 판정 (합격/분실/-)
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

-- 5. 인덱스 생성
CREATE INDEX idx_car_reservations_date ON car_reservations(date, status);
CREATE INDEX idx_car_reservations_user ON car_reservations(user_id);
CREATE INDEX idx_room_reservations_date ON room_reservations(date, resource_type, status);
CREATE INDEX idx_room_reservations_user ON room_reservations(user_id);
CREATE INDEX idx_instruments_instrument_no ON instruments(instrument_no);
CREATE INDEX idx_instruments_serial ON instruments(serial_number);
CREATE INDEX idx_instruments_name ON instruments(name);
CREATE INDEX idx_instruments_english_name ON instruments(english_name);
CREATE INDEX idx_instruments_model ON instruments(model);

-- 5. RLS (Row Level Security) 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;

-- 6. RLS 정책 - 모든 사용자가 읽기/쓰기 가능 (사내 앱이므로)
CREATE POLICY "Allow all access to users" ON users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to car_reservations" ON car_reservations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to room_reservations" ON room_reservations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to car_logs" ON car_logs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to instruments" ON instruments
  FOR ALL USING (true) WITH CHECK (true);

-- 7. Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE car_reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE room_reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE instruments;
ALTER PUBLICATION supabase_realtime ADD TABLE instrument_usages;

-- 8. 차량 예약 중복 방지 (같은 차량, 같은 날짜, 같은 시간대에 confirmed 예약은 1개만)
CREATE UNIQUE INDEX idx_car_unique_booking
  ON car_reservations(car_name, date, period)
  WHERE status = 'confirmed';

-- 8-1. 종일(full) vs 오전/오후(am/pm) 충돌 방지 트리거
CREATE OR REPLACE FUNCTION check_car_period_conflict() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF NEW.period = 'full' THEN
      IF EXISTS (
        SELECT 1 FROM car_reservations
        WHERE car_name = NEW.car_name AND date = NEW.date
          AND status = 'confirmed' AND id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'Car % already reserved on % (full conflicts with any)', NEW.car_name, NEW.date;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM car_reservations
        WHERE car_name = NEW.car_name AND date = NEW.date
          AND status = 'confirmed' AND period = 'full'
          AND id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'Car % already has full-day reservation on %', NEW.car_name, NEW.date;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS car_period_conflict_trigger ON car_reservations;
CREATE TRIGGER car_period_conflict_trigger
  BEFORE INSERT OR UPDATE ON car_reservations
  FOR EACH ROW EXECUTE FUNCTION check_car_period_conflict();

-- 9. 미팅룸/챔버 예약 시간 겹침 방지 함수
CREATE OR REPLACE FUNCTION check_room_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM room_reservations
    WHERE resource_name = NEW.resource_name
      AND date = NEW.date
      AND status = 'confirmed'
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000')
      AND start_time < NEW.end_time
      AND end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Time slot already reserved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER room_overlap_check
  BEFORE INSERT OR UPDATE ON room_reservations
  FOR EACH ROW
  EXECUTE FUNCTION check_room_overlap();

-- 10. instruments 사용 이력 테이블
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

CREATE INDEX idx_instrument_usages_date ON instrument_usages(date);
CREATE INDEX idx_instrument_usages_instrument ON instrument_usages(instrument_id, created_at DESC);

ALTER TABLE instrument_usages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to instrument_usages" ON instrument_usages
  FOR ALL USING (true) WITH CHECK (true);
