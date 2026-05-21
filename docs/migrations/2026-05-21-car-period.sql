-- 차량 예약 시간대 도입 (오전/오후/종일)
-- 적용 방법: Supabase Dashboard → SQL Editor에 통째로 붙여넣고 Run
-- 안전: 트랜잭션 가능. 실패해도 부분 적용 안 됨.

BEGIN;

-- 1. period 컬럼 추가 (기존 row는 모두 'full' 종일로 처리)
ALTER TABLE car_reservations
  ADD COLUMN IF NOT EXISTS period TEXT NOT NULL DEFAULT 'full'
  CHECK (period IN ('am', 'pm', 'full'));

-- 2. 기존 UNIQUE 제약 제거 (car_name, date) → 새 제약(car_name, date, period)로 교체
DROP INDEX IF EXISTS idx_car_unique_booking;

-- 3. 새 UNIQUE 제약: 같은 차량+날짜+시간대 1건만
CREATE UNIQUE INDEX idx_car_unique_booking
  ON car_reservations(car_name, date, period)
  WHERE status = 'confirmed';

-- 4. 종일 vs 오전/오후 충돌 방지 트리거
--    - period='full' 등록 시: 같은 차량/날짜에 다른 confirmed가 있으면 차단
--    - period='am' 또는 'pm' 등록 시: 같은 차량/날짜에 'full' confirmed가 있으면 차단
CREATE OR REPLACE FUNCTION check_car_period_conflict() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF NEW.period = 'full' THEN
      IF EXISTS (
        SELECT 1 FROM car_reservations
        WHERE car_name = NEW.car_name
          AND date = NEW.date
          AND status = 'confirmed'
          AND id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'Car % already has reservation on % (full-day cannot overlap)', NEW.car_name, NEW.date;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM car_reservations
        WHERE car_name = NEW.car_name
          AND date = NEW.date
          AND status = 'confirmed'
          AND period = 'full'
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

COMMIT;

-- 검증 쿼리 (선택): 적용 후 실행하여 모두 'full'인지 확인
-- SELECT period, COUNT(*) FROM car_reservations GROUP BY period;
