"use client"

type Props = {
  backendError?: boolean
  force?: boolean
}

export default function BackendHealthBanner({ backendError, force }: Props) {
  const show = Boolean(force) || Boolean(backendError)
  if (!show) return null
  return (
    <div className="mx-2 mb-2 rounded-md border border-red-300 dark:border-red-900 bg-red-50/60 dark:bg-red-900/20 text-red-800 dark:text-red-300 px-4 py-2 text-sm">
      Error connecting to backend. Some data may be unavailable. Please check your network or try again later.
    </div>
  )
}
