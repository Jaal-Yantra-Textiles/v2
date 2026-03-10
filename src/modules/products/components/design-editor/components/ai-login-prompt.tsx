"use client"

import { Sparkles } from "@medusajs/icons"

type AiLoginPromptProps = {
  isOpen: boolean
  onLogin: () => void
  onCancel: () => void
}

/**
 * Modal component that prompts users to log in before using AI features
 *
 * Shows when an unauthenticated user tries to generate an AI image.
 * Design state is automatically persisted to localStorage before redirect.
 */
export function AiLoginPrompt({ isOpen, onLogin, onCancel }: AiLoginPromptProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="space-y-5">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-neutral-100">
              <Sparkles className="h-5 w-5 text-neutral-700" />
            </div>
          </div>

          {/* Content */}
          <div className="text-center space-y-2">
            <p className="text-sm font-semibold uppercase tracking-widest text-neutral-900">
              Sign in to use AI
            </p>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Create an account or sign in to generate AI-powered design images.
              Your current work will be saved automatically.
            </p>
          </div>

          {/* Benefits list */}
          <div className="rounded-md border border-neutral-100 bg-neutral-50 p-4">
            <ul className="space-y-2 text-xs text-neutral-600">
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-neutral-200 text-neutral-700 text-[10px] font-bold">
                  ✓
                </span>
                Generate unique design bases with AI
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-neutral-200 text-neutral-700 text-[10px] font-bold">
                  ✓
                </span>
                Save and manage your designs
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-neutral-200 text-neutral-700 text-[10px] font-bold">
                  ✓
                </span>
                Get personalized style recommendations
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={onLogin}
              className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-xs font-medium uppercase tracking-widest text-white hover:bg-black transition-colors"
            >
              Sign in to continue
            </button>
            <button
              onClick={onCancel}
              className="w-full rounded-md border border-neutral-200 px-4 py-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              Maybe later
            </button>
          </div>

          {/* Footer note */}
          <p className="text-center text-[11px] text-neutral-400">
            Your design will be saved and restored after signing in.
          </p>
        </div>
      </div>
    </div>
  )
}
