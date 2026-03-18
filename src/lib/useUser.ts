import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import type { User } from './types'

const STORAGE_KEY = 'reservation_user'

export function useUser() {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  })

  const login = useCallback(async (name: string, email: string) => {
    const { data, error } = await supabase
      .from('users')
      .upsert({ name, email }, { onConflict: 'email' })
      .select()
      .single()

    if (error) throw error

    const userData = data as User
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData))
    setUser(userData)
    return userData
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }, [])

  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    }
  }, [user])

  return { user, login, logout }
}
