"use client"

import { Text, Label, Input } from "@medusajs/ui"
import { DesignLayer } from "../types"

type LayerPropertiesProps = {
    layer: DesignLayer
    onChange: (id: string, attrs: Partial<DesignLayer>) => void
}

export function LayerProperties({ layer, onChange }: LayerPropertiesProps) {
    return (
        <div className="border-t p-2">
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
                Properties
            </Text>
            <div className="flex flex-col gap-3">
                {layer.type === "text" && (
                    <>
                        <Input
                            placeholder="Text"
                            value={layer.text || ""}
                            onChange={(e) => onChange(layer.id, { text: e.target.value })}
                            className="text-sm"
                        />
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={layer.fill || "#000000"}
                                onChange={(e) => onChange(layer.id, { fill: e.target.value })}
                                className="h-8 w-8 cursor-pointer rounded border"
                            />
                            <Input
                                type="number"
                                value={layer.fontSize || 24}
                                onChange={(e) => onChange(layer.id, { fontSize: parseInt(e.target.value) || 24 })}
                                className="flex-1 text-sm"
                                placeholder="Size"
                            />
                        </div>
                        <div>
                            <Label className="text-xs text-gray-500 mb-1 block">Font</Label>
                            <select
                                value={layer.fontFamily || "Arial"}
                                onChange={(e) => onChange(layer.id, { fontFamily: e.target.value })}
                                className="w-full text-sm border rounded px-2 py-1.5"
                            >
                                <option value="Arial">Arial</option>
                                <option value="Helvetica">Helvetica</option>
                                <option value="Times New Roman">Times New Roman</option>
                                <option value="Georgia">Georgia</option>
                                <option value="Verdana">Verdana</option>
                                <option value="Courier New">Courier New</option>
                                <option value="Impact">Impact</option>
                                <option value="Comic Sans MS">Comic Sans MS</option>
                            </select>
                        </div>
                        <div className="flex gap-1">
                            <button
                                onClick={() => onChange(layer.id, {
                                    fontStyle: layer.fontStyle === "bold" || layer.fontStyle === "bold italic"
                                        ? layer.fontStyle.replace("bold", "").trim() || "normal"
                                        : layer.fontStyle === "italic" ? "bold italic" : "bold"
                                })}
                                className={`flex-1 py-1 text-sm border rounded ${layer.fontStyle?.includes("bold") ? "bg-gray-200 font-bold" : ""
                                    }`}
                            >
                                B
                            </button>
                            <button
                                onClick={() => onChange(layer.id, {
                                    fontStyle: layer.fontStyle === "italic" || layer.fontStyle === "bold italic"
                                        ? layer.fontStyle.replace("italic", "").trim() || "normal"
                                        : layer.fontStyle === "bold" ? "bold italic" : "italic"
                                })}
                                className={`flex-1 py-1 text-sm border rounded italic ${layer.fontStyle?.includes("italic") ? "bg-gray-200" : ""
                                    }`}
                            >
                                I
                            </button>
                        </div>
                    </>
                )}
                <div>
                    <Label className="text-xs text-gray-500 mb-1 block">
                        Opacity {Math.round(layer.opacity * 100)}%
                    </Label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={layer.opacity}
                        onChange={(e) => onChange(layer.id, { opacity: parseFloat(e.target.value) })}
                        className="w-full"
                    />
                </div>
                <div>
                    <Label className="text-xs text-gray-500 mb-1 block">
                        Rotation {Math.round(layer.rotation)}°
                    </Label>
                    <input
                        type="range"
                        min="-180"
                        max="180"
                        step="1"
                        value={layer.rotation}
                        onChange={(e) => onChange(layer.id, { rotation: parseFloat(e.target.value) })}
                        className="w-full"
                    />
                </div>
            </div>
        </div>
    )
}
