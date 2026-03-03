"use client"

import { useEffect, useRef, useState } from "react"
import { Text as KonvaText, Transformer } from "react-konva"
import Konva from "konva"

import { DesignLayer } from "../types"

interface TextLayerProps {
  layer: DesignLayer
  isSelected: boolean
  onSelect: () => void
  onChange: (attrs: Partial<DesignLayer>) => void
  stageRef?: React.RefObject<Konva.Stage | null>
}

export function TextLayer({ layer, isSelected, onSelect, onChange, stageRef }: TextLayerProps) {
  const shapeRef = useRef<Konva.Text>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  // Clean up any dangling textarea if the component unmounts while editing
  useEffect(() => {
    return () => {
      if (textareaRef.current?.parentNode) {
        textareaRef.current.parentNode.removeChild(textareaRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current && !isEditing) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected, isEditing])

  const handleDblClick = () => {
    if (!shapeRef.current || !stageRef?.current) return

    const textNode = shapeRef.current
    const stage = stageRef.current
    const stageBox = stage.container().getBoundingClientRect()

    textNode.hide()
    if (trRef.current) trRef.current.hide()
    setIsEditing(true)

    const textPosition = textNode.absolutePosition()
    const areaPosition = {
      x: stageBox.left + textPosition.x * stage.scaleX() + stage.x(),
      y: stageBox.top + textPosition.y * stage.scaleY() + stage.y(),
    }

    const textarea = document.createElement("textarea")
    document.body.appendChild(textarea)
    textareaRef.current = textarea

    textarea.value = layer.text || ""
    textarea.style.position = "fixed"
    textarea.style.top = `${areaPosition.y}px`
    textarea.style.left = `${areaPosition.x}px`
    textarea.style.width = `${Math.max(textNode.width() * stage.scaleX() * textNode.scaleX(), 100)}px`
    textarea.style.height = `${Math.max(textNode.height() * stage.scaleY() * textNode.scaleY() + 10, 40)}px`
    textarea.style.fontSize = `${(layer.fontSize || 24) * stage.scaleX()}px`
    textarea.style.fontFamily = layer.fontFamily || "Arial"
    textarea.style.color = layer.fill || "#000000"
    textarea.style.border = "2px solid #4f46e5"
    textarea.style.borderRadius = "4px"
    textarea.style.padding = "4px"
    textarea.style.margin = "0"
    textarea.style.overflow = "hidden"
    textarea.style.background = "white"
    textarea.style.outline = "none"
    textarea.style.resize = "none"
    textarea.style.lineHeight = "1.2"
    textarea.style.transformOrigin = "left top"
    textarea.style.zIndex = "1000"

    textarea.focus()
    textarea.select()

    const removeTextarea = () => {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea)
      }
      textareaRef.current = null
      textNode.show()
      if (trRef.current) trRef.current.show()
      setIsEditing(false)
    }

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onChange({ text: textarea.value })
        removeTextarea()
      }
      if (e.key === "Escape") {
        removeTextarea()
      }
    })

    textarea.addEventListener("blur", () => {
      onChange({ text: textarea.value })
      removeTextarea()
    })
  }

  return (
    <>
      <KonvaText
        ref={shapeRef}
        text={layer.text || "Text"}
        x={layer.x}
        y={layer.y}
        fontSize={layer.fontSize || 24}
        fontFamily={layer.fontFamily || "Arial"}
        fontStyle={layer.fontStyle || "normal"}
        fill={layer.fill || "#000000"}
        rotation={layer.rotation}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        opacity={layer.opacity}
        draggable={layer.draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          })
        }}
        onTransformEnd={() => {
          const node = shapeRef.current
          if (!node) return

          onChange({
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
          })
        }}
      />
      {isSelected && !isEditing && (
        <Transformer
          ref={trRef}
          enabledAnchors={["middle-left", "middle-right"]}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 20) {
              return oldBox
            }
            return newBox
          }}
        />
      )}
    </>
  )
}
