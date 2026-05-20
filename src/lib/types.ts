export interface User {
  id: string
  name: string
  email: string
  is_admin: boolean
  created_at: string
}

export interface CarReservation {
  id: string
  user_id: string
  user_name: string
  car_name: string
  date: string
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

export const MEETING_ROOMS = ['미팅룸7', '미팅룸8']
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
