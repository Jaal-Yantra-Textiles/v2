"use client"

import { Button, Text } from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import { RawMaterial } from "@lib/data/raw-materials"

type MaterialDetailModalProps = {
    isOpen: boolean
    onClose: () => void
    material: RawMaterial
    onRemove: () => void
}

export function MaterialDetailModal({
    isOpen,
    onClose,
    material,
    onRemove,
}: MaterialDetailModalProps) {
    if (!isOpen || !material) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="bg-neutral-900 text-white px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🧵</span>
                        <div>
                            <h3 className="font-semibold text-lg">
                                {material.name || material.material_type?.name || 'Material'}
                            </h3>
                            {material.material_type?.category && (
                                <p className="text-neutral-300 text-sm">{material.material_type.category}</p>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-neutral-800 rounded">
                        <XMark className="h-5 w-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 space-y-4">
                    {/* Preview Image */}
                    {(() => {
                        const mediaArr = Array.isArray(material.media) ? material.media : []
                        const thumb = mediaArr.find(m => m.isThumbnail)?.url || mediaArr[0]?.url
                        if (thumb) {
                            return <img src={thumb} alt="" className="w-full h-48 object-cover rounded-lg" />
                        }
                        return (
                            <div
                                className="w-full h-48 rounded-lg flex items-center justify-center"
                                style={{ backgroundColor: material.color || '#e5e5e5' }}
                            >
                                <span className="text-6xl">🧵</span>
                            </div>
                        )
                    })()}

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {material.color && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Color</div>
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-6 h-6 rounded-full border-2 border-gray-200"
                                        style={{ backgroundColor: material.color }}
                                    />
                                    <span className="text-sm font-medium">{material.color}</span>
                                </div>
                            </div>
                        )}

                        {material.composition && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Composition</div>
                                <span className="text-sm font-medium">{material.composition}</span>
                            </div>
                        )}

                        {material.material_type?.name && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Type</div>
                                <span className="text-sm font-medium">{material.material_type.name}</span>
                            </div>
                        )}

                        {material.material_type?.description && (
                            <div className="bg-gray-50 rounded-lg p-3 col-span-2">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Description</div>
                                <span className="text-sm">{material.material_type.description}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="border-t px-6 py-4 flex justify-between items-center bg-gray-50">
                    <button
                        onClick={() => {
                            onRemove()
                            onClose()
                        }}
                        className="text-sm text-red-600 hover:text-red-700"
                    >
                        Remove Selection
                    </button>
                    <Button size="small" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </div>
    )
}
