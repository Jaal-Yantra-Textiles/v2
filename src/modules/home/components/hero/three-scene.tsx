"use client"

import { Canvas, useFrame } from "@react-three/fiber"
import { Image, Environment } from "@react-three/drei"
import { useRef } from "react"
import * as THREE from "three"

interface ThreeSceneProps {
    images: Array<{ id: string; url: string; alt: string }>
}

function FloatingImage({ url, index, total }: { url: string; index: number; total: number }) {
    const ref = useRef<THREE.Mesh>(null)

    // Random initial position within a range
    const position = useRef([
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 5
    ])

    // Random rotation speed
    const speed = useRef({
        x: (Math.random() - 0.5) * 0.002,
        y: (Math.random() - 0.5) * 0.002,
        z: (Math.random() - 0.5) * 0.002
    })

    useFrame((state) => {
        if (!ref.current) return

        // Float animation
        ref.current.rotation.x += speed.current.x
        ref.current.rotation.y += speed.current.y
        ref.current.rotation.z += speed.current.z

        // Mouse parallax effect
        // Smoothly interpolate position towards mouse influence
        // Original position + small offset based on mouse
        const x = position.current[0] + (state.pointer.x * 1)
        const y = position.current[1] + (state.pointer.y * 1)

        // Lerp current position to target
        ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, x, 0.05)
        ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, y, 0.05)

    })

    // Distribute items in a cloud
    const theta = (index / total) * Math.PI * 2
    const r = 4 + Math.random() * 2 // Radius
    const x = r * Math.cos(theta)
    const y = (Math.random() - 0.5) * 4
    const z = r * Math.sin(theta) - 2

    return (
        <Image
            ref={ref}
            url={url}
            transparent
            side={THREE.DoubleSide}
            position={[x, y, z]}
            scale={[2.5, 3.5]} // Portrait aspect ratio roughly
        >
            <planeGeometry />
        </Image>
    )
}

function Scene({ images }: { images: ThreeSceneProps['images'] }) {
    return (
        <group>
            {images.map((img, i) => (
                <FloatingImage
                    key={img.id}
                    url={img.url}
                    index={i}
                    total={images.length}
                />
            ))}
            <ambientLight intensity={0.5} />
            <Environment preset="city" />
        </group>
    )
}

export default function ThreeScene({ images }: ThreeSceneProps) {
    // Limit images to improve performance
    const displayImages = images.slice(0, 8)

    return (
        <div className="absolute inset-0 z-0 h-full w-full">
            <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 10], fov: 35 }}>
                <Scene images={displayImages} />
            </Canvas>
        </div>
    )
}
