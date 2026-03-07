import { DesignLayer } from "../types"

// Excalidraw element types
export type ExcalidrawElement = {
    id: string
    type: "rectangle" | "text" | "image" | "frame"
    x: number
    y: number
    width: number
    height: number
    angle: number
    strokeColor: string
    backgroundColor: string
    fillStyle: "solid" | "hachure" | "cross-hatch"
    strokeWidth: number
    roughness: number
    opacity: number
    seed: number
    version: number
    versionNonce: number
    isDeleted: boolean
    boundElements: null
    updated: number
    link: null
    locked: boolean
    // Text specific
    text?: string
    fontSize?: number
    fontFamily?: number
    textAlign?: "left" | "center" | "right"
    verticalAlign?: "top" | "middle" | "bottom"
    // Image specific
    fileId?: string
    status?: "pending" | "saved" | "error"
    scale?: [number, number]
}

export type ExcalidrawFile = {
    type: "excalidraw"
    version: number
    source: string
    elements: ExcalidrawElement[]
    appState: {
        viewBackgroundColor: string
        gridSize: null
    }
    files: Record<string, {
        mimeType: string
        id: string
        dataURL: string
        created: number
    }>
}

// Generate random seed for Excalidraw
const generateSeed = () => Math.floor(Math.random() * 2147483647)

// Convert Konva layers to Excalidraw format
export function convertToExcalidraw(
    layers: DesignLayer[],
    baseImageUrl?: string,
    baseImageDimensions?: { width: number; height: number },
    productName?: string,
    materialName?: string,
    partnerName?: string
): ExcalidrawFile {
    const elements: ExcalidrawElement[] = []
    const files: ExcalidrawFile["files"] = {}
    const now = Date.now()

    // Add a frame/container for the design
    const frameId = `frame-${now}`
    const frameWidth = baseImageDimensions?.width || 600
    const frameHeight = baseImageDimensions?.height || 800

    // Add title text at the top
    if (productName) {
        elements.push({
            id: `title-${now}`,
            type: "text",
            x: 20,
            y: 20,
            width: 400,
            height: 40,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 1,
            roughness: 0,
            opacity: 100,
            seed: generateSeed(),
            version: 1,
            versionNonce: generateSeed(),
            isDeleted: false,
            boundElements: null,
            updated: now,
            link: null,
            locked: false,
            text: `Design: ${productName}`,
            fontSize: 28,
            fontFamily: 1,
            textAlign: "left",
            verticalAlign: "top",
        })
    }

    // Add info section with material and partner
    let infoY = 70
    if (materialName) {
        elements.push({
            id: `material-info-${now}`,
            type: "text",
            x: 20,
            y: infoY,
            width: 300,
            height: 24,
            angle: 0,
            strokeColor: "#6366f1",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 1,
            roughness: 0,
            opacity: 100,
            seed: generateSeed(),
            version: 1,
            versionNonce: generateSeed(),
            isDeleted: false,
            boundElements: null,
            updated: now,
            link: null,
            locked: false,
            text: `Material: ${materialName}`,
            fontSize: 16,
            fontFamily: 1,
            textAlign: "left",
            verticalAlign: "top",
        })
        infoY += 28
    }

    if (partnerName) {
        elements.push({
            id: `partner-info-${now}`,
            type: "text",
            x: 20,
            y: infoY,
            width: 300,
            height: 24,
            angle: 0,
            strokeColor: "#22c55e",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 1,
            roughness: 0,
            opacity: 100,
            seed: generateSeed(),
            version: 1,
            versionNonce: generateSeed(),
            isDeleted: false,
            boundElements: null,
            updated: now,
            link: null,
            locked: false,
            text: `Partner: ${partnerName}`,
            fontSize: 16,
            fontFamily: 1,
            textAlign: "left",
            verticalAlign: "top",
        })
        infoY += 28
    }

    // Add a rectangle to represent the canvas area
    const canvasStartY = infoY + 20
    elements.push({
        id: `canvas-frame-${now}`,
        type: "rectangle",
        x: 20,
        y: canvasStartY,
        width: frameWidth,
        height: frameHeight,
        angle: 0,
        strokeColor: "#e5e5e5",
        backgroundColor: "#fafafa",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 0,
        opacity: 100,
        seed: generateSeed(),
        version: 1,
        versionNonce: generateSeed(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
    })

    // Convert each layer
    layers.forEach((layer, index) => {
        const elementId = `layer-${layer.id}-${now}`
        const offsetX = 20
        const offsetY = canvasStartY

        if (layer.type === "text" && layer.text) {
            // Convert text layer
            elements.push({
                id: elementId,
                type: "text",
                x: offsetX + layer.x,
                y: offsetY + layer.y,
                width: (layer.width || 200) * layer.scaleX,
                height: (layer.height || 30) * layer.scaleY,
                angle: (layer.rotation * Math.PI) / 180, // Convert degrees to radians
                strokeColor: layer.fill || "#1e1e1e",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                roughness: 0,
                opacity: layer.opacity * 100,
                seed: generateSeed(),
                version: 1,
                versionNonce: generateSeed(),
                isDeleted: false,
                boundElements: null,
                updated: now,
                link: null,
                locked: false,
                text: layer.text,
                fontSize: layer.fontSize || 24,
                fontFamily: 1, // 1 = Virgil (hand-drawn), 2 = Helvetica, 3 = Cascadia
                textAlign: "left",
                verticalAlign: "top",
            })
        } else if (layer.type === "image") {
            const imgWidth = (layer.width || 100) * layer.scaleX
            const imgHeight = (layer.height || 100) * layer.scaleY

            if (layer.src && layer.src.startsWith("http")) {
                // Persistent S3 URL — add as a real Excalidraw image element
                const fileId = `file-${layer.id}`
                files[fileId] = {
                    mimeType: "image/jpeg",
                    id: fileId,
                    dataURL: layer.src as any,
                    created: now,
                }
                elements.push({
                    id: elementId,
                    type: "image",
                    x: offsetX + layer.x,
                    y: offsetY + layer.y,
                    width: imgWidth,
                    height: imgHeight,
                    angle: (layer.rotation * Math.PI) / 180,
                    strokeColor: "transparent",
                    backgroundColor: "transparent",
                    fillStyle: "solid",
                    strokeWidth: 0,
                    roughness: 0,
                    opacity: layer.opacity * 100,
                    seed: generateSeed(),
                    version: 1,
                    versionNonce: generateSeed(),
                    isDeleted: false,
                    boundElements: null,
                    updated: now,
                    link: layer.src,
                    locked: false,
                    fileId,
                    status: "saved",
                    scale: [1, 1],
                })
            } else {
                // Blob or missing src — placeholder rectangle
                elements.push({
                    id: elementId,
                    type: "rectangle",
                    x: offsetX + layer.x,
                    y: offsetY + layer.y,
                    width: imgWidth,
                    height: imgHeight,
                    angle: (layer.rotation * Math.PI) / 180,
                    strokeColor: "#6366f1",
                    backgroundColor: "#e0e7ff",
                    fillStyle: "cross-hatch",
                    strokeWidth: 2,
                    roughness: 1,
                    opacity: layer.opacity * 100,
                    seed: generateSeed(),
                    version: 1,
                    versionNonce: generateSeed(),
                    isDeleted: false,
                    boundElements: null,
                    updated: now,
                    link: null,
                    locked: false,
                })
                elements.push({
                    id: `${elementId}-label`,
                    type: "text",
                    x: offsetX + layer.x + 5,
                    y: offsetY + layer.y + 5,
                    width: imgWidth - 10,
                    height: 20,
                    angle: 0,
                    strokeColor: "#4338ca",
                    backgroundColor: "transparent",
                    fillStyle: "solid",
                    strokeWidth: 1,
                    roughness: 0,
                    opacity: 100,
                    seed: generateSeed(),
                    version: 1,
                    versionNonce: generateSeed(),
                    isDeleted: false,
                    boundElements: null,
                    updated: now,
                    link: null,
                    locked: false,
                    text: `[Image ${index + 1} — not yet uploaded]`,
                    fontSize: 12,
                    fontFamily: 2,
                    textAlign: "left",
                    verticalAlign: "top",
                })
            }
        }
    })

    // Add notes section at the bottom
    const notesY = canvasStartY + frameHeight + 30
    elements.push({
        id: `notes-header-${now}`,
        type: "text",
        x: 20,
        y: notesY,
        width: 200,
        height: 24,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 0,
        opacity: 100,
        seed: generateSeed(),
        version: 1,
        versionNonce: generateSeed(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
        text: "Designer Notes:",
        fontSize: 18,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",

    })

    // Add placeholder for notes
    elements.push({
        id: `notes-area-${now}`,
        type: "rectangle",
        x: 20,
        y: notesY + 30,
        width: frameWidth,
        height: 100,
        angle: 0,
        strokeColor: "#d4d4d4",
        backgroundColor: "#fef9c3",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 0,
        opacity: 50,
        seed: generateSeed(),
        version: 1,
        versionNonce: generateSeed(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
    })

    elements.push({
        id: `notes-placeholder-${now}`,
        type: "text",
        x: 30,
        y: notesY + 45,
        width: frameWidth - 20,
        height: 60,
        angle: 0,
        strokeColor: "#a3a3a3",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 0,
        opacity: 100,
        seed: generateSeed(),
        version: 1,
        versionNonce: generateSeed(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
        text: "Add your design notes here...",
        fontSize: 14,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
    })

    return {
        type: "excalidraw",
        version: 2,
        source: "jyt-design-editor",
        elements,
        appState: {
            viewBackgroundColor: "#ffffff",
            gridSize: null,
        },
        files,
    }
}
