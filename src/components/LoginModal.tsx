import { useState } from 'react'

interface Props {
  onLogin: (name: string, email: string) => Promise<unknown>
}

export default function LoginModal({ onLogin }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setLoading(true)
    setError('')
    try {
      await onLogin(name.trim(), email.trim().toLowerCase())
    } catch {
      setError('로그인 실패. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-(--color-surface) p-6 shadow-xl">
        <h2 className="mb-1 text-xl font-bold text-(--color-text)">사내 예약 시스템</h2>
        <p className="mb-6 text-sm text-(--color-text-secondary)">이름과 이메일을 입력해주세요</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="이름"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
            required
          />
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) outline-none focus:border-(--color-primary-light)"
            required
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-(--color-primary) py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          >
            {loading ? '로그인 중...' : '시작하기'}
          </button>
        </form>
      </div>
    </div>
  )
}
