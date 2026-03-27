import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}

export default function Modal({ open, onClose, title, headerRight, children }: Props) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-(--color-surface) p-5 shadow-xl animate-[slideUp_0.2s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-(--color-text)">{title}</h3>
            {headerRight}
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-(--color-border)">
            <X size={20} className="text-(--color-text-secondary)" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
