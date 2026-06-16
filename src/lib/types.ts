export interface User {
  id: string
  name: string
  email: string
  is_admin: boolean
  created_at: string
}

export type CarPeriod = 'am' | 'pm' | 'full'

export interface CarReservation {
  id: string
  user_id: string
  user_name: string
  car_name: string
  date: string
  period: CarPeriod
  destination: string
  reason: string | null
  status: string
  created_at: string
}

export interface RoomReservation {
  id: string
  user_id: string
  user_name: string
  resource_type: 'meeting_room' | 'chamber'
  resource_name: string
  date: string
  start_time: string
  end_time: string
  purpose: string
  status: string
  created_at: string
}

export interface CarLog {
  id: string
  reservation_id: string
  user_id: string
  user_name: string
  car_name: string
  date: string
  department: string | null
  odo_before: number | null
  odo_after: number | null
  distance: number | null
  commute_distance: number | null
  business_distance: number | null
  note: string | null
  created_at: string
}

export type TabType = 'car' | 'room' | 'chamber' | 'instrument' | 'my'

export interface Car {
  name: string
  color: string
  bgLight: string
  bgDark: string
}

export const CARS: Car[] = [
  { name: '카니발', color: '#2563eb', bgLight: '#dbeafe', bgDark: '#1e3a5f' },
  { name: '싼타페', color: '#16a34a', bgLight: '#dcfce7', bgDark: '#14532d' },
  { name: '레이', color: '#ea580c', bgLight: '#ffedd5', bgDark: '#7c2d12' },
]

export interface MeetingRoom {
  name: string
  badge: string
  color: string
  reservationColor: { bg: string; border: string; text: string }
  /** true면 예약 불가 (조회만 가능) */
  disabled?: boolean
}

export const MEETING_ROOMS: MeetingRoom[] = [
  {
    name: '미팅룸7(GEO)',
    badge: 'GEO',
    color: '#6366f1',
    reservationColor: { bg: 'rgba(96,165,250,0.35)', border: 'rgba(96,165,250,0.8)', text: '#1e40af' },
  },
  {
    name: '미팅룸7(MEO)',
    badge: 'MEO',
    color: '#14b8a6',
    reservationColor: { bg: 'rgba(45,212,191,0.35)', border: 'rgba(20,184,166,0.8)', text: '#115e59' },
  },
  {
    name: '미팅룸7(LEO)',
    badge: 'LEO',
    color: '#94a3b8',
    reservationColor: { bg: 'rgba(148,163,184,0.35)', border: 'rgba(100,116,139,0.8)', text: '#334155' },
    disabled: true,
  },
  {
    name: '미팅룸8',
    badge: '8',
    color: '#0ea5e9',
    reservationColor: { bg: 'rgba(251,182,206,0.45)', border: 'rgba(244,143,177,0.8)', text: '#9d174d' },
  },
]

export const CHAMBERS = ['챔버']

export interface Instrument {
  id: string
  no: number | null
  instrument_no: string | null
  name: string | null
  english_name: string | null
  model: string | null
  serial_number: string | null
  manufacturer: string | null
  specification: string | null
  purchase_price: number | null
  purchase_from: string | null
  purchase_period: string | null
  calibration_cycle: string | null
  last_calibration_date: string | null
  next_calibration_date: string | null
  judgment_criteria: string | null
  status: string | null
  department: string | null
  datalink: string | null
  q_business: string | null
  validation_fm: string | null
  validation_qm: string | null
  remarks: string | null
  remarks2: string | null
  created_at: string
  updated_at?: string
}

export interface InstrumentUsage {
  id: string
  instrument_id: string | null
  instrument_no: string | null
  name: string | null
  english_name: string | null
  model: string | null
  user_id: string
  user_name: string
  date: string
  created_at: string
}
