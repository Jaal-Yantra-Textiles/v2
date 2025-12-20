import React from "react"
import { Button } from "@medusajs/ui"

type SuspendedWorkflowProps = {
    reason: string
    options: Array<{ id: string; display: string }>
    actions?: Array<{ id: string; label: string }>
    onSelect: (id: string, type?: "option" | "action") => void
    isLoading?: boolean
}

export const SuspendedWorkflowSelector: React.FC<SuspendedWorkflowProps> = ({
    reason,
    options,
    actions,
    onSelect,
    isLoading = false,
}) => {
    return (
        <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950/20 space-y-3">
            <div className="flex items-start gap-2">
                <div className="flex-shrink-0 mt-1">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div className="flex-1">
                    <p className="font-medium text-sm text-blue-900 dark:text-blue-100 mb-3">{reason}</p>
                    <div className="space-y-2">
                        {options.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => onSelect(option.id, "option")}
                                disabled={isLoading}
                                className="w-full text-left px-4 py-3 border border-blue-200 dark:border-blue-800 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-900"
                            >
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{option.display}</span>
                            </button>
                        ))}
                    </div>
                    {actions && actions.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-blue-200 dark:border-blue-800 flex flex-wrap gap-2">
                            {actions.map((action) => (
                                <Button
                                    key={action.id}
                                    variant="secondary"
                                    size="small"
                                    onClick={() => onSelect(action.id, "action")}
                                    disabled={isLoading}
                                >
                                    {action.label}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
