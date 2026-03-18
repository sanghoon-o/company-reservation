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

-- 4. 인덱스 생성
CREATE INDEX idx_car_reservations_date ON car_reservations(date, status);
CREATE INDEX idx_car_reservations_user ON car_reservations(user_id);
CREATE INDEX idx_room_reservations_date ON room_reservations(date, resource_type, status);
CREATE INDEX idx_room_reservations_user ON room_reservations(user_id);

-- 5. RLS (Row Level Security) 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_reservations ENABLE ROW LEVEL SECURITY;

-- 6. RLS 정책 - 모든 사용자가 읽기/쓰기 가능 (사내 앱이므로)
CREATE POLICY "Allow all access to users" ON users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to car_reservations" ON car_reservations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to room_reservations" ON room_reservations
  FOR ALL USING (true) WITH CHECK (true);

-- 7. Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE car_reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE room_reservations;

-- 8. 차량 예약 중복 방지 (같은 차량, 같은 날짜에 confirmed 예약은 1개만)
CREATE UNIQUE INDEX idx_car_unique_booking
  ON car_reservations(car_name, date)
  WHERE status = 'confirmed';

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
