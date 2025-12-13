import { useState, useEffect, useCallback } from "react"
import Editor, { Monaco } from "@monaco-editor/react"
import { Button, Text } from "@medusajs/ui"
import { PencilSquare, ExclamationCircle, CheckCircle } from "@medusajs/icons"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"

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
  modalId?: string
}

export function CodeEditorModal({
  code,
  onChange,
  packages = [],
  modalId = "code-editor-modal",
}: CodeEditorModalProps) {
  const [localCode, setLocalCode] = useState(code)
  const [errors, setErrors] = useState<string[]>([])
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null)
  
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
          <div className="h-full overflow-hidden rounded-md border border-ui-border-base">
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
