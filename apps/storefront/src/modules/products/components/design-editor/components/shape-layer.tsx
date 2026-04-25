"use client"

import { useEffect, useRef } from "react"
import { Rect, Circle, Transformer } from "react-konva"
import Konva from "konva"
import { DesignLayer } from "../types"

type ShapeLayerProps = {
  layer: DesignLayer
  isSelected: boolean
  onSelect: () => void
  onChange: (attrs: Partial<DesignLayer>) => void
}

export function ShapeLayer({ layer, isSelected, onSelect, onChange }: ShapeLayerProps) {
  const shapeRef = useRef<Konva.Rect | Konva.Circle>(null)
  const trRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current as any])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  const sharedProps = {
    id: layer.id,
    x: layer.x,
    y: layer.y,
    width: layer.width ?? 100,
    height: layer.height ?? 100,
    rotation: layer.rotation,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    opacity: layer.opacity,
    fill: layer.fill ?? "#e2e8f0",
    stroke: layer.strokeColor ?? undefined,
    strokeWidth: layer.strokeWidth ?? 0,
    globalCompositeOperation: (layer.blendMode as any) ?? "source-over",
    draggable: layer.draggable && !layer.locked,
    listening: layer.opacity > 0,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onChange({ x: e.target.x(), y: e.target.y() }),
    onTransformEnd: () => {
      const node = shapeRef.current
      if (!node) return
      onChange({
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      })
    },
  }

  return (
    <>
      {layer.type === "rect" ? (
        <Rect ref={shapeRef as React.RefObject<Konva.Rect>} {...sharedProps} cornerRadius={layer.cornerRadius ?? 0} />
      ) : (
        <Circle ref={shapeRef as React.RefObject<Konva.Circle>} {...sharedProps} />
      )}
      {isSelected && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
        />
      )}
    </>
  )
}
