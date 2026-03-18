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

export type TabType = 'car' | 'room' | 'chamber' | 'my'

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
