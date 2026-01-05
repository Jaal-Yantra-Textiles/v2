"use client"

import { Button, Text } from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import { Partner } from "../types"

type PartnerDetailModalProps = {
    isOpen: boolean
    onClose: () => void
    partner: Partner
    onRemove: () => void
}

export function PartnerDetailModal({
    isOpen,
    onClose,
    partner,
    onRemove,
}: PartnerDetailModalProps) {
    if (!isOpen || !partner) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="bg-green-500 text-white px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {partner.logo_url ? (
                            <img src={partner.logo_url} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white" />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-green-400 flex items-center justify-center border-2 border-white">
                                <span className="text-2xl">🏭</span>
                            </div>
                        )}
                        <div>
                            <h3 className="font-semibold text-lg">
                                {partner.company_name || partner.name || 'Partner'}
                            </h3>
                            {partner.type && (
                                <p className="text-green-100 text-sm">{partner.type}</p>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-green-600 rounded">
                        <XMark className="h-5 w-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 space-y-4">
                    {/* Partner Info */}
                    <div className="space-y-3">
                        {partner.name && partner.company_name && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Contact Name</div>
                                <span className="text-sm font-medium">{partner.name}</span>
                            </div>
                        )}

                        {partner.description && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">About</div>
                                <span className="text-sm">{partner.description}</span>
                            </div>
                        )}

                        {partner.type && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Specialization</div>
                                <span className="inline-block bg-green-100 text-green-700 text-sm px-3 py-1 rounded-full">
                                    {partner.type}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Production Badge */}
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                        <div className="text-green-600 text-sm font-medium mb-1">✓ Selected for Production</div>
                        <div className="text-gray-600 text-xs">This partner will produce your custom design</div>
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
