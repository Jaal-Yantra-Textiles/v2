import { useRef, useEffect, useCallback } from "react"

// ---------------------------------------------------------------------------
// WebGL shaders for fabric texture displacement
// ---------------------------------------------------------------------------
const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;
  uniform sampler2D u_depth;
  uniform sampler2D u_normal;
  uniform vec2 u_mouse;       // -1..1 mouse offset for parallax
  uniform float u_strength;   // displacement strength
  uniform float u_hasNormal;  // 1.0 if normal map is loaded

  void main() {
    // Read depth — grayscale, use red channel
    float depth = texture2D(u_depth, v_texCoord).r;

    // Parallax offset: shift texture UVs based on depth and mouse position
    vec2 offset = u_mouse * depth * u_strength;
    vec2 displaced_uv = v_texCoord + offset;

    // Clamp to avoid sampling outside
    displaced_uv = clamp(displaced_uv, 0.0, 1.0);

    vec4 color = texture2D(u_texture, displaced_uv);

    // If we have a normal map, add subtle directional lighting
    if (u_hasNormal > 0.5) {
      vec3 normal = texture2D(u_normal, displaced_uv).rgb * 2.0 - 1.0;
      // Light direction influenced by mouse
      vec3 lightDir = normalize(vec3(u_mouse.x * 0.5, u_mouse.y * 0.5, 1.0));
      float diffuse = max(dot(normal, lightDir), 0.0);
      // Blend lighting: 60% original + 40% lit
      color.rgb = mix(color.rgb, color.rgb * (0.4 + 0.6 * diffuse), 0.4);
    }

    // Add slight depth-based shadow for texture pop
    color.rgb *= 0.7 + 0.3 * depth;

    gl_FragColor = color;
  }
`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface Texture3DViewerProps {
  textureUrl: string
  depthUrl: string
  normalUrl?: string | null
  width?: number
  height?: number
  strength?: number
}

export function Texture3DViewer({
  textureUrl,
  depthUrl,
  normalUrl,
  width = 300,
  height = 300,
  strength = 0.03,
}: Texture3DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const mouseRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number>(0)
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({})
  const texturesLoadedRef = useRef(0)

  // ---------------------------------------------------------------------------
  // Initialize WebGL
  // ---------------------------------------------------------------------------
  const initGL = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const gl = canvas.getContext("webgl", { alpha: false, antialias: true })
    if (!gl) return null

    // Compile shaders
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, VERTEX_SHADER)
    gl.compileShader(vs)

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, FRAGMENT_SHADER)
    gl.compileShader(fs)

    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Fragment shader error:", gl.getShaderInfoLog(fs))
      return null
    }

    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.useProgram(program)

    // Full-screen quad
    const positions = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ])
    const texCoords = new Float32Array([
      0, 1, 1, 1, 0, 0,
      0, 0, 1, 1, 1, 0,
    ])

    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, "a_position")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const texBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf)
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)
    const aTex = gl.getAttribLocation(program, "a_texCoord")
    gl.enableVertexAttribArray(aTex)
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0)

    // Store uniform locations
    uniformsRef.current = {
      u_texture: gl.getUniformLocation(program, "u_texture"),
      u_depth: gl.getUniformLocation(program, "u_depth"),
      u_normal: gl.getUniformLocation(program, "u_normal"),
      u_mouse: gl.getUniformLocation(program, "u_mouse"),
      u_strength: gl.getUniformLocation(program, "u_strength"),
      u_hasNormal: gl.getUniformLocation(program, "u_hasNormal"),
    }

    // Set texture unit indices
    gl.uniform1i(uniformsRef.current.u_texture, 0)
    gl.uniform1i(uniformsRef.current.u_depth, 1)
    gl.uniform1i(uniformsRef.current.u_normal, 2)
    gl.uniform1f(uniformsRef.current.u_strength, strength)
    gl.uniform1f(uniformsRef.current.u_hasNormal, 0)

    glRef.current = gl
    programRef.current = program
    return gl
  }, [strength])

  // ---------------------------------------------------------------------------
  // Load a texture from URL into a WebGL texture unit
  // ---------------------------------------------------------------------------
  const loadTexture = useCallback(
    (gl: WebGLRenderingContext, url: string, unit: number) => {
      const texture = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)

      // Placeholder pixel
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([128, 128, 128, 255])
      )

      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        texturesLoadedRef.current++
      }
      img.src = url
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------
  const render = useCallback(() => {
    const gl = glRef.current
    if (!gl || texturesLoadedRef.current < 2) {
      rafRef.current = requestAnimationFrame(render)
      return
    }

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.uniform2f(
      uniformsRef.current.u_mouse,
      mouseRef.current.x,
      mouseRef.current.y
    )
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    rafRef.current = requestAnimationFrame(render)
  }, [])

  // ---------------------------------------------------------------------------
  // Setup & teardown
  // ---------------------------------------------------------------------------
  useEffect(() => {
    texturesLoadedRef.current = 0
    const gl = initGL()
    if (!gl) return

    loadTexture(gl, textureUrl, 0)
    loadTexture(gl, depthUrl, 1)

    if (normalUrl) {
      loadTexture(gl, normalUrl, 2)
      gl.uniform1f(uniformsRef.current.u_hasNormal, 1)
    }

    rafRef.current = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [textureUrl, depthUrl, normalUrl, initGL, loadTexture, render])

  // ---------------------------------------------------------------------------
  // Mouse interaction
  // ---------------------------------------------------------------------------
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      mouseRef.current = {
        x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
        y: -((e.clientY - rect.top) / rect.height - 0.5) * 2,
      }
    },
    []
  )

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: 0, y: 0 }
  }, [])

  // Touch support for mobile
  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      const touch = e.touches[0]
      if (!touch) return
      const rect = e.currentTarget.getBoundingClientRect()
      mouseRef.current = {
        x: ((touch.clientX - rect.left) / rect.width - 0.5) * 2,
        y: -((touch.clientY - rect.top) / rect.height - 0.5) * 2,
      }
    },
    []
  )

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseLeave}
      className="rounded-md border border-ui-border-base cursor-crosshair w-full"
      style={{ aspectRatio: `${width}/${height}` }}
    />
  )
}
