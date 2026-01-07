"use client"

import { useEffect, useMemo, useState } from "react"
import clsx from "clsx"
import { Button, Text, Label, Input } from "@medusajs/ui"
import {
    BadgeOption,
    BadgePreferences,
    BadgeCategory,
    MultiBadgeCategory,
} from "../types"

const multiSelectCategories: MultiBadgeCategory[] = ["colorPalette", "occasion"]

const BADGE_OPTIONS: Record<BadgeCategory, BadgeOption[]> = {
    style: [
        { label: "Minimal", value: "minimal" },
        { label: "Boho", value: "boho" },
        { label: "Avant-garde", value: "avant_garde" },
        { label: "Classic", value: "classic" },
        { label: "Streetwear", value: "streetwear" },
    ],
    colorPalette: [
        { label: "Monochrome", value: "mono", swatch: "#0f172a" },
        { label: "Earth", value: "earth", swatch: "#9a6b4f" },
        { label: "Pastels", value: "pastel", swatch: "#f5cde0" },
        { label: "Bold Pop", value: "bold", swatch: "#f97316" },
        { label: "Neutrals", value: "neutral", swatch: "#d4d4d8" },
    ],
    bodyType: [
        { label: "Petite", value: "petite" },
        { label: "Tall", value: "tall" },
        { label: "Curvy", value: "curvy" },
        { label: "Athletic", value: "athletic" },
    ],
    silhouette: [
        { label: "A-line", value: "aline" },
        { label: "Column", value: "column" },
        { label: "Oversized", value: "oversized" },
        { label: "Structured", value: "structured" },
    ],
    embellishment: [
        { label: "Clean", value: "clean", helper: "Little-to-no detail" },
        { label: "Balanced", value: "balanced", helper: "Select accents" },
        { label: "Maximal", value: "maximal", helper: "Statement flourishes" },
    ],
    occasion: [
        { label: "Daily", value: "daily" },
        { label: "Workwear", value: "work" },
        { label: "Celebration", value: "celebration" },
        { label: "Wedding", value: "wedding" },
        { label: "Resort", value: "resort" },
    ],
}

type WizardStepId = "name" | BadgeCategory

type NameModalProps = {
    isOpen: boolean
    productTitle: string
    designName: string
    setDesignName: (name: string) => void
    badgePreferences: BadgePreferences
    setBadgePreferences: React.Dispatch<React.SetStateAction<BadgePreferences>>
    initialStep?: WizardStepId
    onSubmit: () => void
    onSkip: () => void
}

const BADGE_HEADER: Record<BadgeCategory, string> = {
    style: "Style DNA",
    colorPalette: "Color Direction",
    bodyType: "Body Type",
    silhouette: "Silhouette Focus",
    embellishment: "Embellishment Level",
    occasion: "Occasion",
}

const BADGE_SUBTEXT: Record<BadgeCategory, string> = {
    style: "Pick the vibe closest to your idea.",
    colorPalette: "Choose up to two palettes to explore.",
    bodyType: "Helps us tailor silhouettes to fit best.",
    silhouette: "Overall shape or drape inspiration.",
    embellishment: "Preferred level of detail or texture.",
    occasion: "Where will this piece be worn?",
}

const badgeStepOrder: BadgeCategory[] = [
    "style",
    "colorPalette",
    "bodyType",
    "silhouette",
    "embellishment",
    "occasion",
]

export function NameModal({
    isOpen,
    productTitle,
    designName,
    setDesignName,
    badgePreferences,
    setBadgePreferences,
    initialStep = "name",
    onSubmit,
    onSkip,
}: NameModalProps) {
    if (!isOpen) return null

    const steps = useMemo(
        () =>
            [
                { id: "name" as WizardStepId, label: "Name" },
                ...badgeStepOrder.map((category) => ({
                    id: category as WizardStepId,
                    label: BADGE_HEADER[category],
                    category,
                })),
            ] as const,
        []
    )

    const [stepIndex, setStepIndex] = useState(0)
    const currentStep = steps[stepIndex]
    const canContinueName = designName.trim().length > 0

    useEffect(() => {
        if (!isOpen) return
        const targetStep = initialStep ?? "name"
        const targetIndex = steps.findIndex((step) => step.id === targetStep)
        setStepIndex(targetIndex >= 0 ? targetIndex : 0)
    }, [isOpen, initialStep, steps])

    const nextStepLabel = steps[stepIndex + 1]?.label

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/10 backdrop-blur-md px-4">
            <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/85 p-8 shadow-2xl backdrop-blur-xl">
                <div className="space-y-6">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-gray-600">
                            <span>Step {stepIndex + 1} of {steps.length}</span>
                            <span className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-semibold text-gray-700">
                                {currentStep.label}
                            </span>
                        </div>
                        <div>
                            <Text weight="plus" className="text-xl text-gray-900">
                                {currentStep.id === "name"
                                    ? "Name Your Design"
                                    : BADGE_HEADER[currentStep.id as BadgeCategory]}
                            </Text>
                            <Text size="small" className="text-gray-700">
                                {currentStep.id === "name"
                                    ? `Give your custom ${productTitle} design a name.`
                                    : BADGE_SUBTEXT[currentStep.id as BadgeCategory]}
                            </Text>
                        </div>
                    </div>
                    {currentStep.id === "name" && (
                        <div className="space-y-3">
                            <Label htmlFor="designName" className="text-xs uppercase tracking-wide text-gray-500">
                                Design Name
                            </Label>
                            <Input
                                id="designName"
                                autoFocus
                                value={designName}
                                onChange={(e) => setDesignName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && canContinueName) {
                                        setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))
                                    }
                                }}
                                placeholder="e.g., Summer Collection Tee"
                                className="rounded-2xl border-white/50 bg-white/60 backdrop-blur placeholder:text-gray-400"
                            />
                        </div>
                    )}
                    {currentStep.id !== "name" && (
                        <div className="space-y-5">
                            {(() => {
                                const category = currentStep.id as BadgeCategory
                                if (isMultiCategory(category)) {
                                    return (
                                        <BadgeSection
                                            key={category}
                                            category={category}
                                            title={BADGE_HEADER[category]}
                                            description={BADGE_SUBTEXT[category]}
                                            selected={badgePreferences[category] as string[]}
                                            onSelect={(values) =>
                                                setBadgePreferences((prev) => ({
                                                    ...prev,
                                                    [category]: values,
                                                }))
                                            }
                                            multi
                                        />
                                    )
                                }
                                return (
                                    <BadgeSection
                                        key={category}
                                        category={category}
                                        title={BADGE_HEADER[category]}
                                        description={BADGE_SUBTEXT[category]}
                                        selected={badgePreferences[category] as string | null}
                                        onSelect={(value) =>
                                            setBadgePreferences((prev) => ({
                                                ...prev,
                                                [category]: value,
                                            }))
                                        }
                                    />
                                )
                            })()}
                        </div>
                    )}
                    <div className="flex justify-between gap-3 pt-2">
                        {stepIndex === 0 ? (
                            <>
                                <Button variant="secondary" onClick={onSkip} className="rounded-full">
                                    Skip
                                </Button>
                                <Button
                                    onClick={() => setStepIndex(1)}
                                    disabled={!canContinueName}
                                    className="rounded-full shadow-lg disabled:shadow-none"
                                >
                                    Next: Style DNA
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
                                    className="rounded-full"
                                >
                                    Back
                                </Button>
                                <Button
                                    onClick={() => {
                                        if (stepIndex === steps.length - 1) {
                                            onSubmit()
                                        } else {
                                            setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))
                                        }
                                    }}
                                    className="rounded-full shadow-lg"
                                >
                                    {stepIndex === steps.length - 1
                                        ? "Save & Continue"
                                        : nextStepLabel
                                            ? `Next: ${nextStepLabel}`
                                            : "Next"}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function isMultiCategory(category: BadgeCategory): category is MultiBadgeCategory {
    return multiSelectCategories.includes(category as MultiBadgeCategory)
}

type BadgeSectionProps =
    | {
        category: Exclude<BadgeCategory, MultiBadgeCategory>
        title: string
        description: string
        selected: string | null
        onSelect: (value: string | null) => void
        multi?: false
    }
    | {
        category: MultiBadgeCategory
        title: string
        description: string
        selected: string[]
        onSelect: (values: string[]) => void
        multi: true
    }

function BadgeSection(props: BadgeSectionProps) {
    const { category, title, description } = props
    const options = BADGE_OPTIONS[category]

    const handleSelect = (value: string) => {
        if (props.multi) {
            const isSelected = props.selected.includes(value)
            const nextValues = isSelected
                ? props.selected.filter((v) => v !== value)
                : [...props.selected, value].slice(0, 3)
            props.onSelect(nextValues)
        } else {
            props.onSelect(props.selected === value ? null : value)
        }
    }

    const isSelected = (value: string) => {
        if (props.multi) {
            return props.selected.includes(value)
        }
        return props.selected === value
    }

    return (
        <div className="rounded-2xl border border-white/60 bg-white/60 p-4 backdrop-blur">
            <div className="mb-3">
                <Text weight="plus" className="text-gray-900">
                    {title}
                </Text>
                <Text size="small" className="text-xs text-gray-500">
                    {description}
                </Text>
            </div>
            <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => handleSelect(option.value)}
                        className={clsx(
                            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                            isSelected(option.value)
                                ? "border-black bg-black text-white shadow-lg"
                                : "border-gray-200 bg-white/70 text-gray-700 hover:border-gray-300"
                        )}
                    >
                        {option.swatch && (
                            <span
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: option.swatch }}
                            />
                        )}
                        {option.label}
                        {option.helper && (
                            <span className="text-[10px] font-normal text-gray-400">
                                {option.helper}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    )
}
