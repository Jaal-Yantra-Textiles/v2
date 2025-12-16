import { useState, useEffect, useCallback } from "react"
import Editor, { Monaco } from "@monaco-editor/react"
import { Button, Text, Input, Label, Textarea, Checkbox } from "@medusajs/ui"
import { PencilSquare, ExclamationCircle, CheckCircle, Spinner } from "@medusajs/icons"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"
import { useVisualFlowCodegen } from "../../hooks/api/ai"

/**
 * Generate TypeScript declarations for sandbox globals
 * Uses `declare global` to make them available in all files
 */
function generateSandboxDeclarations(packages: string[]): string {
  const packageDecls = packages
    .map(p => {
      const varName = p.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "")
      return `  const ${varName}: any;`
    })
    .join("\n")
  
  return `
declare global {
  // Sandbox data variables
  const $last: any;
  const $input: Record<string, any>;
  const $trigger: any;
  const $context: { flowId: string; executionId: string };
  
  // Built-in packages
  const _: any;
  const lodash: any;
  const dayjs: any;
  const uuid: { v4: () => string; v5: (name: string, namespace: string) => string; validate: (uuid: string) => boolean };
  const validator: any;
  const crypto: { hash: (algo: string, data: string) => string; randomBytes: (size: number) => string };
  const fetch: typeof globalThis.fetch;
  const sleep: (ms: number) => Promise<void>;
  
  // User-specified packages
${packageDecls}
}
export {};
`
}

interface CodeEditorModalProps {
  code: string
  onChange: (code: string) => void
  packages?: string[]
  onPackagesChange?: (packages: string[]) => void
  flowId?: string
  operationKey?: string
  availableOperationKeys?: string[]
  variableSuggestions?: Array<{ label: string; value: string }>
  modalId?: string
}

export function CodeEditorModal({
  code,
  onChange,
  packages = [],
  onPackagesChange,
  flowId,
  operationKey,
  availableOperationKeys = [],
  variableSuggestions = [],
  modalId = "code-editor-modal",
}: CodeEditorModalProps) {
  const [localCode, setLocalCode] = useState(code)
  const [errors, setErrors] = useState<string[]>([])
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null)

  const visualFlowCodegen = useVisualFlowCodegen()
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiDesiredOutputKeys, setAiDesiredOutputKeys] = useState("")
  const [aiAllowExternalPackages, setAiAllowExternalPackages] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiMessages, setAiMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([])
  const [aiLastResult, setAiLastResult] = useState<any | null>(null)
  
  // Configure Monaco when it mounts
  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    // Add sandbox declarations as extra lib
    const declarations = generateSandboxDeclarations(packages)
    
    // Disable semantic validation since we can't reliably declare sandbox globals
    // Keep syntax validation for catching obvious errors
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,  // Disable "Cannot find name" errors
      noSyntaxValidation: false,   // Keep syntax errors like missing brackets
    })
    
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      strict: false,
      noImplicitAny: false,
      // These are key - allow top-level await and don't require function body for return
      allowUnreachableCode: true,
      allowUnusedLabels: true,
    })
    
    // Add the sandbox declarations as a global lib
    // Use file:// URI to ensure it's treated as a declaration file
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      declarations,
      "file:///node_modules/@types/sandbox-globals/index.d.ts"
    )
    
    setMonacoInstance(monaco)
  }, [packages])
  
  // Update declarations when packages change
  useEffect(() => {
    if (monacoInstance) {
      const declarations = generateSandboxDeclarations(packages)
      monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
        declarations,
        "file:///node_modules/@types/sandbox-globals/index.d.ts"
      )
    }
  }, [packages, monacoInstance])
  
  // Errors to ignore - these are valid in our sandbox context
  const IGNORED_ERROR_PATTERNS = [
    /await.*only allowed.*top level/i,
    /return.*only.*within a function/i,
    /has no imports or exports/i,
    /Consider adding.*export/i,
  ]
  
  // Get errors from Monaco markers
  const handleEditorValidation = useCallback((markers: { message: string; severity: number }[]) => {
    // Filter to only errors (severity 8) and warnings (severity 4)
    // Also filter out sandbox-specific false positives
    const errorMessages = markers
      .filter(m => m.severity >= 4)
      .filter(m => !IGNORED_ERROR_PATTERNS.some(pattern => pattern.test(m.message)))
      .map(m => m.message)
      .slice(0, 5) // Limit to 5 errors
    setErrors(errorMessages)
  }, [])

  const handleOpen = () => {
    setLocalCode(code)
  }

  const handleSave = () => {
    onChange(localCode)
  }
  
  // Update local code when external code changes
  useEffect(() => {
    setLocalCode(code)
  }, [code])
  
  const isValid = errors.length === 0
  const canGenerate = aiPrompt.trim().length > 0 && !visualFlowCodegen.isPending

  const applyAiResult = () => {
    if (!aiLastResult) {
      return
    }
    if (typeof aiLastResult.code === "string") {
      setLocalCode(aiLastResult.code)
    }
    if (Array.isArray(aiLastResult.packages) && onPackagesChange) {
      onPackagesChange(aiLastResult.packages)
    }
  }

  return (
    <StackedFocusModal id={modalId}>
      <StackedFocusModal.Trigger asChild>
        <Button variant="secondary" size="small" onClick={handleOpen}>
          <PencilSquare className="w-4 h-4 mr-1" />
          Open Editor
        </Button>
      </StackedFocusModal.Trigger>
      <StackedFocusModal.Content className="flex h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] flex-col">
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Edit JavaScript Code</StackedFocusModal.Title>
          <StackedFocusModal.Description>
            <span className="block">
              <strong>Data:</strong>{" "}
              <code className="bg-ui-bg-subtle px-1 rounded">$last</code>, 
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">$input</code>, 
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">$trigger</code>
            </span>
            <span className="block mt-1">
              <strong>Packages:</strong>{" "}
              <code className="bg-ui-bg-subtle px-1 rounded">_</code> (lodash), 
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">dayjs</code>, 
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">uuid</code>, 
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">validator</code>,
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">crypto</code>,
              <code className="bg-ui-bg-subtle px-1 rounded ml-1">fetch</code>
            </span>
          </StackedFocusModal.Description>
        </StackedFocusModal.Header>

        <StackedFocusModal.Body className="flex-1 overflow-hidden px-6 py-4">
          <div className="flex h-full overflow-hidden rounded-md border border-ui-border-base">
            <div className="flex-1 overflow-hidden">
              <Editor
                height="100%"
                defaultLanguage="typescript"
                path="file:///sandbox-code.ts"
                value={localCode}
                onChange={(value) => setLocalCode(value || "")}
                beforeMount={handleEditorWillMount}
                onValidate={handleEditorValidation}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: "on",
                  padding: { top: 16, bottom: 16 },
                  suggestOnTriggerCharacters: true,
                  quickSuggestions: true,
                  folding: true,
                  bracketPairColorization: { enabled: true },
                }}
              />
            </div>

            <div className="w-96 border-l border-ui-border-base bg-ui-bg-subtle p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Text weight="plus" className="text-sm">
                  AI Assist
                </Text>
                <Button
                  size="small"
                  variant="secondary"
                  type="button"
                  isLoading={visualFlowCodegen.isPending}
                  disabled={!canGenerate}
                  onClick={async () => {
                    try {
                      setAiError(null)
                      const desired = aiDesiredOutputKeys
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)

                      setAiMessages((prev) => [
                        ...prev,
                        { role: "user", content: aiPrompt.trim() },
                      ])

                      const resp = await visualFlowCodegen.mutateAsync({
                        prompt: aiPrompt.trim(),
                        desiredOutputKeys: desired.length ? desired : undefined,
                        allowExternalPackages: aiAllowExternalPackages,
                        resourceId: flowId
                          ? `ai:visual-flow-codegen:${flowId}`
                          : "ai:visual-flow-codegen",
                        context: {
                          operationType: "execute_code",
                          operationKey,
                          availableOperationKeys,
                          variableSuggestions,
                        },
                      } as any)

                      const result: any = (resp as any)?.result || {}
                      setAiLastResult(result)
                      setAiMessages((prev) => [
                        ...prev,
                        {
                          role: "assistant",
                          content:
                            typeof result?.code === "string"
                              ? result.code
                              : "(no code returned)",
                        },
                      ])
                    } catch (e: any) {
                      setAiError(e?.message || "Failed to generate code")
                    }
                  }}
                >
                  Generate
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto rounded border border-ui-border-base bg-ui-bg-base p-2">
                {visualFlowCodegen.isPending && aiMessages.length === 0 ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="flex items-center gap-2">
                      <Spinner className="animate-spin" />
                      <Text className="text-xs text-ui-fg-subtle">Generating…</Text>
                    </div>
                  </div>
                ) : aiMessages.length === 0 ? (
                  <Text className="text-xs text-ui-fg-subtle">
                    Write a prompt and click Generate. You can then Apply the
                    result into the editor.
                  </Text>
                ) : (
                  <div className="flex flex-col gap-2">
                    {aiMessages.map((m, idx) => (
                      <div
                        key={idx}
                        className={
                          m.role === "user"
                            ? "self-end max-w-[90%] rounded bg-ui-bg-subtle p-2"
                            : "self-start max-w-[90%] rounded bg-ui-bg-subtle-hover p-2"
                        }
                      >
                        <Text className="text-[11px] text-ui-fg-subtle">
                          {m.role === "user" ? "You" : "AI"}
                        </Text>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-ui-fg-base font-mono">
                          {m.content}
                          {visualFlowCodegen.isPending && idx === aiMessages.length - 1 && m.role === "user" ? (
                            <Spinner className="inline-block ml-1 align-middle animate-spin" />
                          ) : null}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <Label htmlFor={`${modalId}-ai-prompt`}>Prompt</Label>
                  <Textarea
                    id={`${modalId}-ai-prompt`}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    rows={3}
                    placeholder="Describe what you want this node to do..."
                  />
                </div>

                <div>
                  <Label htmlFor={`${modalId}-ai-output-keys`}>
                    Desired output keys (comma-separated)
                  </Label>
                  <Input
                    id={`${modalId}-ai-output-keys`}
                    value={aiDesiredOutputKeys}
                    onChange={(e) => setAiDesiredOutputKeys(e.target.value)}
                    placeholder="items, count, byHandle"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={aiAllowExternalPackages}
                    onCheckedChange={(checked) =>
                      setAiAllowExternalPackages(Boolean(checked))
                    }
                  />
                  <Text className="text-xs text-ui-fg-subtle">
                    Allow external packages
                  </Text>
                </div>

                {aiError && (
                  <Text className="text-xs text-ui-fg-error">{aiError}</Text>
                )}

                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    type="button"
                    disabled={!aiLastResult}
                    onClick={applyAiResult}
                  >
                    Apply
                  </Button>
                  <Text className="text-xs text-ui-fg-subtle">
                    Will replace editor content
                  </Text>
                </div>
              </div>
            </div>
          </div>
        </StackedFocusModal.Body>

        <StackedFocusModal.Footer>
          <div className="flex w-full flex-col gap-2">
            {/* Validation errors from Monaco */}
            {errors.length > 0 && (
              <div className="flex items-start gap-2 p-2 bg-ui-bg-subtle-hover border border-ui-border-error rounded">
                <ExclamationCircle className="w-4 h-4 text-ui-fg-error mt-0.5 flex-shrink-0" />
                <div className="flex flex-col gap-1">
                  {errors.map((error: string, i: number) => (
                    <Text key={i} className="text-xs text-ui-fg-error">
                      {error}
                    </Text>
                  ))}
                </div>
              </div>
            )}
            
            {/* Valid indicator */}
            {isValid && localCode.trim() && (
              <div className="flex items-center gap-2 text-ui-fg-subtle">
                <CheckCircle className="w-4 h-4 text-ui-fg-interactive" />
                <Text className="text-xs">Code looks good</Text>
              </div>
            )}
            
            <div className="flex w-full items-center justify-between">
              <Text className="text-xs text-ui-fg-subtle">
                Tip: Use <code className="bg-ui-bg-subtle px-1 rounded">return</code> to output data
              </Text>
              <div className="flex items-center gap-x-2">
                <StackedFocusModal.Close asChild>
                  <Button variant="secondary">Cancel</Button>
                </StackedFocusModal.Close>
                <StackedFocusModal.Close asChild>
                  <Button variant="primary" onClick={handleSave}>
                    Save and Close
                  </Button>
                </StackedFocusModal.Close>
              </div>
            </div>
          </div>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}
