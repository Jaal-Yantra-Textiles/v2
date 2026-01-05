"use client"

import { Button, Text, Label, Input } from "@medusajs/ui"

type NameModalProps = {
    isOpen: boolean
    productTitle: string
    designName: string
    setDesignName: (name: string) => void
    onSubmit: () => void
    onSkip: () => void
}

export function NameModal({
    isOpen,
    productTitle,
    designName,
    setDesignName,
    onSubmit,
    onSkip,
}: NameModalProps) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/10 backdrop-blur-md">
            <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white/80 p-8 shadow-2xl backdrop-blur-xl">
                <div className="space-y-4">
                    <div>
                        <Text weight="plus" className="text-lg text-gray-900">
                            Name Your Design
                        </Text>
                        <Text size="small" className="text-gray-600">
                            Give your custom {productTitle} design a name.
                        </Text>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="designName" className="text-xs uppercase tracking-wide text-gray-500">
                            Design Name
                        </Label>
                        <Input
                            id="designName"
                            autoFocus
                            value={designName}
                            onChange={(e) => setDesignName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") onSubmit()
                            }}
                            placeholder="e.g., Summer Collection Tee"
                            className="rounded-2xl border-white/50 bg-white/60 backdrop-blur placeholder:text-gray-400"
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="secondary" onClick={onSkip} className="rounded-full">
                            Skip
                        </Button>
                        <Button onClick={onSubmit} disabled={!designName.trim()} className="rounded-full shadow-lg disabled:shadow-none">
                            Continue
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
