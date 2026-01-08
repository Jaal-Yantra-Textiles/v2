"use client"

import { Button, Text } from "@medusajs/ui"
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
      <div className="w-full max-w-sm rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="space-y-5">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-blue-100">
              <Sparkles className="h-7 w-7 text-purple-600" />
            </div>
          </div>

          {/* Content */}
          <div className="text-center space-y-2">
            <Text weight="plus" className="text-lg text-gray-900">
              Sign in to use AI
            </Text>
            <Text size="small" className="text-gray-600">
              Create an account or sign in to generate AI-powered design images.
              Your current work will be saved automatically.
            </Text>
          </div>

          {/* Benefits list */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4">
            <ul className="space-y-2 text-xs text-gray-600">
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600 text-[10px]">
                  ✓
                </span>
                Generate unique design bases with AI
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600 text-[10px]">
                  ✓
                </span>
                Save and manage your designs
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600 text-[10px]">
                  ✓
                </span>
                Get personalized style recommendations
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={onLogin}
              className="w-full rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg hover:from-purple-700 hover:to-blue-700"
            >
              Sign in to continue
            </Button>
            <Button
              variant="secondary"
              onClick={onCancel}
              className="w-full rounded-full"
            >
              Maybe later
            </Button>
          </div>

          {/* Footer note */}
          <Text size="small" className="text-center text-[11px] text-gray-400">
            Your design will be saved and restored after signing in.
          </Text>
        </div>
      </div>
    </div>
  )
}
