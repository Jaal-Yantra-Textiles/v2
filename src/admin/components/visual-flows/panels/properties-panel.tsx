import { Text, Heading, IconButton, Button, Input, Label, Textarea, Select, Checkbox, Badge } from "@medusajs/ui"
import { XMark, Trash, MagnifyingGlass } from "@medusajs/icons"
import { Edge, Node } from "@xyflow/react"
import { useState, useEffect, useMemo } from "react"
import { useFlowMetadata, EntityMetadata, WorkflowInputField } from "../../../hooks/api/visual-flows"
import { CodeEditorModal } from "../code-editor-modal"
import { StackedFocusModal } from "../../modal/stacked-modal/stacked-focused-modal"

interface PropertiesPanelProps {
  node: Node
  allNodes?: Node[]
  edges?: Edge[]
  flowId?: string
  onUpdate: (data: Record<string, any>) => void
  onDelete: () => void
  onClose: () => void
}

export function PropertiesPanel({ node, allNodes = [], edges = [], flowId, onUpdate, onDelete, onClose }: PropertiesPanelProps) {
  const { data: metadata, isLoading: metadataLoading } = useFlowMetadata()
  const [label, setLabel] = useState(String(node.data.label || ""))
  const [operationKey, setOperationKey] = useState(String(node.data.operationKey || ""))
  const [options, setOptions] = useState<Record<string, any>>(node.data.options || {})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedJson, setAdvancedJson] = useState("")
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [conditionExpressionError, setConditionExpressionError] = useState<string | null>(null)
  const [workflowSearch, setWorkflowSearch] = useState("")
  const [showRawWorkflowJson, setShowRawWorkflowJson] = useState(false)

  // Get entities from metadata
  const entities = metadata?.entities || []
  const workflows = metadata?.workflows || []
  
  // Get selected entity's fields
  const selectedEntity = useMemo(() => {
    return entities.find((e: EntityMetadata) => e.name === options.entity)
  }, [entities, options.entity])
  
  const entityFields = selectedEntity?.fields || []
  const filterableFields = entityFields.filter((f: any) => f.filterable)

  const queryableCustomEntities = useMemo(() => {
    return entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable)
  }, [entities])

  const queryableCoreEntities = useMemo(() => {
    return entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable)
  }, [entities])

  const nonQueryableCustomEntities = useMemo(() => {
    return entities.filter((e: EntityMetadata) => e.type === "custom" && !e.queryable)
  }, [entities])

  const nonQueryableCoreEntities = useMemo(() => {
    return entities.filter((e: EntityMetadata) => e.type === "core" && !e.queryable)
  }, [entities])

  const upstreamNodeIds = useMemo(() => {
    const incoming = new Map<string, Set<string>>()
    for (const e of edges) {
      const target = String((e as any)?.target || "")
      const source = String((e as any)?.source || "")
      if (!target || !source) continue
      if (!incoming.has(target)) {
        incoming.set(target, new Set())
      }
      incoming.get(target)!.add(source)
    }

    const visited = new Set<string>()
    const queue: string[] = [String(node.id)]
    while (queue.length) {
      const current = queue.shift()!
      const parents = incoming.get(current)
      if (!parents) continue
      for (const p of parents) {
        if (visited.has(p)) continue
        visited.add(p)
        queue.push(p)
      }
    }

    return visited
  }, [edges, node.id])

  const availableOperationKeys = useMemo(() => {
    const nodeById = new Map<string, Node>()
    for (const n of allNodes) {
      if (!n) continue
      nodeById.set(String(n.id), n)
    }

    const keys = new Set<string>()
    for (const id of upstreamNodeIds) {
      const n = nodeById.get(String(id))
      if (!n) continue
      if (n.type !== "operation") continue
      const k = String((n as any).data?.operationKey || "").trim()
      if (k) keys.add(k)
    }

    return Array.from(keys)
  }, [allNodes, upstreamNodeIds])

  const variableSuggestions = useMemo(() => {
    const out: Array<{ label: string; value: string }> = []
    out.push({ label: "$last", value: "{{ $last }}" })
    out.push({ label: "$input", value: "{{ $input }}" })
    out.push({ label: "$trigger", value: "{{ $trigger }}" })
    for (const k of availableOperationKeys) {
      out.push({ label: `${k}`, value: `{{ ${k} }}` })
      out.push({ label: `${k}.items`, value: `{{ ${k}.items }}` })
      out.push({ label: `${k}.records`, value: `{{ ${k}.records }}` })
    }
    return out
  }, [availableOperationKeys])

  // Only reset local state when switching to a different node.
  // Do NOT include node.data — every updateOption call creates a new node.data
  // reference via handleNodeUpdate → setNodes, which would fire this effect and
  // reset mid-edit state, causing the visible "catching up" lag.
  useEffect(() => {
    setLabel(String(node.data.label || ""))
    setOperationKey(String(node.data.operationKey || ""))
    setOptions(node.data.options || {})
    setAdvancedJson(JSON.stringify(node.data.options || {}, null, 2))
    setJsonError(null)
    setConditionExpressionError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const parseConditionExpressionToFilterRule = (raw: string): {
    filterRule?: Record<string, any>
    error?: string
  } => {
    const trimmed = String(raw || "").trim()
    if (!trimmed) {
      return { filterRule: {} }
    }

    const stripMustache = (value: string) => {
      const v = value.trim()
      const m = v.match(/^\{\{\s*([^}]+)\s*\}\}$/)
      return m ? m[1].trim() : v
    }

    const withoutMustache = trimmed.replace(/^\{\{\s*|\s*\}\}$/g, "").trim()

    // Handle "in" operator: `field in ["a", "b"]` or `field not in ["a", "b"]`
    const inMatch = withoutMustache.match(/^(.+?)\s+(not\s+in|in)\s+(\[.+\])$/i)
    if (inMatch) {
      const left = stripMustache(inMatch[1])
      const isNot = inMatch[2].toLowerCase().startsWith("not")
      const op = isNot ? "_nin" : "_in"
      let expected: any[]
      try {
        expected = JSON.parse(inMatch[3])
        if (!Array.isArray(expected)) throw new Error()
      } catch {
        return { error: `Invalid array for "in" operator. Use JSON format: ["a", "b"]` }
      }
      return { filterRule: { [left]: { [op]: expected } } }
    }

    // Handle binary operators: `field == value`, `field > 0`, etc.
    const match = withoutMustache.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
    if (!match) {
      return {
        error:
          'Unsupported expression. Use comparisons like:\n• $last.count > 0\n• extracted.object.email_type == "order_received"\n• extracted.object.email_type in ["order_received", "confirmation"]',
      }
    }

    const left = stripMustache(match[1])
    const operator = match[2]
    const rightRaw = stripMustache(match[3])

    const operatorMap: Record<string, string> = {
      "==": "_eq",
      "!=": "_neq",
      ">": "_gt",
      ">=": "_gte",
      "<": "_lt",
      "<=": "_lte",
    }

    const op = operatorMap[operator]
    if (!op) {
      return { error: `Unsupported operator: ${operator}` }
    }

    let expected: any = rightRaw
    if (/^(true|false)$/i.test(rightRaw)) {
      expected = rightRaw.toLowerCase() === "true"
    } else if (/^null$/i.test(rightRaw)) {
      expected = null
    } else if (/^[-+]?\d+(\.\d+)?$/.test(rightRaw)) {
      expected = Number(rightRaw)
    } else if (
      (rightRaw.startsWith("\"") && rightRaw.endsWith("\"")) ||
      (rightRaw.startsWith("'") && rightRaw.endsWith("'"))
    ) {
      expected = rightRaw.slice(1, -1)
    }

    return {
      filterRule: {
        [left]: {
          [op]: expected,
        },
      },
    }
  }

  const updateOption = (key: string, value: any) => {
    setOptions(prev => {
      const newOptions = { ...prev, [key]: value }
      setAdvancedJson(JSON.stringify(newOptions, null, 2))
      // Auto-apply changes to parent
      onUpdate({
        label,
        operationKey,
        options: newOptions,
      })
      return newOptions
    })
  }
  
  const updateOptions = (updates: Record<string, any>) => {
    setOptions(prev => {
      const newOptions = { ...prev, ...updates }
      setAdvancedJson(JSON.stringify(newOptions, null, 2))
      onUpdate({ label, operationKey, options: newOptions })
      return newOptions
    })
  }

  const handleSave = () => {
    if (showAdvanced) {
      try {
        const parsedOptions = JSON.parse(advancedJson)
        setJsonError(null)
        // Sync options state so switching back to simple mode doesn't overwrite with stale values
        setOptions(parsedOptions)
        onUpdate({
          label,
          operationKey,
          options: parsedOptions,
        })
      } catch (e) {
        setJsonError("Invalid JSON")
        return
      }
    } else {
      onUpdate({
        label,
        operationKey,
        options,
      })
    }
  }

  const isTrigger = node.type === "trigger"
  const operationType = String(node.data.operationType || "")

  // Render operation-specific fields
  const renderOperationFields = () => {
    switch (operationType) {
      case "read_data":
        return (
          <>
            <div>
              <Label htmlFor="entity">Entity *</Label>
              <Select
                value={options.entity || ""}
                onValueChange={(value) => {
                  updateOption("entity", value)
                  // Reset fields when entity changes
                  updateOption("fields", undefined)
                  updateOption("filters", undefined)
                }}
              >
                <Select.Trigger>
                  <Select.Value placeholder={metadataLoading ? "Loading..." : "Select entity..."} />
                </Select.Trigger>
                <Select.Content>
                  {entities.length > 0 ? (
                    <>
                      {/* Custom entities first */}
                      {queryableCustomEntities.length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Custom Modules</Text>
                          {queryableCustomEntities.map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              <span>{entity.name}</span>
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                      {/* Core entities */}
                      {queryableCoreEntities.length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Core Entities</Text>
                          {queryableCoreEntities.map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}

                      {/* Non-queryable entities (disabled) */}
                      {nonQueryableCustomEntities.length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Custom Modules (Not queryable)</Text>
                          {nonQueryableCustomEntities.map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name} disabled>
                              <div className="flex flex-col">
                                <span className="opacity-60">{entity.name}</span>
                                {entity.queryError && (
                                  <span className="text-xs text-ui-fg-subtle opacity-60 truncate">
                                    {entity.queryError}
                                  </span>
                                )}
                              </div>
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}

                      {nonQueryableCoreEntities.length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Core Entities (Not queryable)</Text>
                          {nonQueryableCoreEntities.map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name} disabled>
                              <div className="flex flex-col">
                                <span className="opacity-60">{entity.name}</span>
                                {entity.queryError && (
                                  <span className="text-xs text-ui-fg-subtle opacity-60 truncate">
                                    {entity.queryError}
                                  </span>
                                )}
                              </div>
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                    </>
                  ) : (
                    <Text className="px-2 py-2 text-ui-fg-muted">No entities available</Text>
                  )}
                </Select.Content>
              </Select>
              {options.entity && selectedEntity && (
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  {selectedEntity.description}
                </Text>
              )}
              {options.entity && selectedEntity && !selectedEntity.queryable && (
                <Text className="text-xs text-ui-tag-red-text mt-1">
                  This entity is registered but not queryable via <code className="bg-ui-bg-subtle px-1">query.graph</code>.
                  {selectedEntity.queryError ? ` ${selectedEntity.queryError}` : ""}
                </Text>
              )}

              {(nonQueryableCustomEntities.length > 0 || nonQueryableCoreEntities.length > 0) && (
                <div className="mt-3 rounded border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
                  <Text className="text-xs text-ui-fg-subtle">
                    Registered entities not available for read operations
                  </Text>
                  <div className="mt-2 space-y-2">
                    {nonQueryableCustomEntities.length > 0 && (
                      <div>
                        <Text className="text-xs text-ui-fg-muted">Custom</Text>
                        <div className="mt-1 space-y-1">
                          {nonQueryableCustomEntities.map((e) => (
                            <div key={e.name} className="flex items-start gap-2">
                              <Badge size="2xsmall" color="grey">
                                {e.name}
                              </Badge>
                              <Text className="text-xs text-ui-fg-subtle line-clamp-2">
                                {e.queryError || "Not queryable via query.graph"}
                              </Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {nonQueryableCoreEntities.length > 0 && (
                      <div>
                        <Text className="text-xs text-ui-fg-muted">Core</Text>
                        <div className="mt-1 space-y-1">
                          {nonQueryableCoreEntities.map((e) => (
                            <div key={e.name} className="flex items-start gap-2">
                              <Badge size="2xsmall" color="grey">
                                {e.name}
                              </Badge>
                              <Text className="text-xs text-ui-fg-subtle line-clamp-2">
                                {e.queryError || "Not queryable via query.graph"}
                              </Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Fields selection */}
            {options.entity && entityFields.length > 0 && (
              <div>
                <Label>Fields to retrieve</Label>
                <div className="mt-1 max-h-32 overflow-y-auto border rounded p-2 space-y-1">
                  {entityFields.map((field: any) => (
                    <label key={field.name} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-ui-bg-base-hover rounded px-1">
                      <Checkbox
                        checked={(options.fields || []).includes(field.name)}
                        onCheckedChange={(checked) => {
                          const isChecked = Boolean(checked)

                          setOptions((prev) => {
                            const currentFields = Array.isArray(prev.fields) ? prev.fields : []
                            const nextFields = isChecked
                              ? Array.from(new Set([...currentFields, field.name]))
                              : currentFields.filter((f: string) => f !== field.name)

                            const newOptions = {
                              ...prev,
                              fields: nextFields.length ? nextFields : undefined,
                            }

                            setAdvancedJson(JSON.stringify(newOptions, null, 2))
                            onUpdate({
                              label,
                              operationKey,
                              options: newOptions,
                            })

                            return newOptions
                          })
                        }}
                      />
                      <span>{field.name}</span>
                      <Badge size="2xsmall" color="grey">{field.type}</Badge>
                    </label>
                  ))}
                </div>
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  Leave empty to retrieve all fields
                </Text>
              </div>
            )}

            {/* Filters */}
            {options.entity && filterableFields.length > 0 && (
              <div>
                <Label>Filters</Label>
                <div className="mt-1 space-y-2">
                  {filterableFields.slice(0, 5).map((field: any) => (
                    <div key={field.name} className="flex items-center gap-2">
                      <Text className="text-xs w-24 truncate" title={field.name}>{field.name}</Text>
                      <Input
                        size="small"
                        placeholder={`Filter by ${field.name}...`}
                        value={options.filters?.[field.name] || ""}
                        onChange={(e) => {
                          const currentFilters = options.filters || {}
                          if (e.target.value) {
                            updateOption("filters", { ...currentFilters, [field.name]: e.target.value })
                          } else {
                            const { [field.name]: _, ...rest } = currentFilters
                            updateOption("filters", Object.keys(rest).length > 0 ? rest : undefined)
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  Use {"{{ variable }}"} for dynamic values
                </Text>
              </div>
            )}

            <div>
              <Label htmlFor="limit">Limit</Label>
              <Input
                id="limit"
                type="number"
                value={options.limit || 100}
                onChange={(e) => updateOption("limit", parseInt(e.target.value) || 100)}
              />
            </div>
          </>
        )

      case "create_data":
        return (
          <>
            <div>
              <Label htmlFor="entity">Entity *</Label>
              <Select
                value={options.entity || ""}
                onValueChange={(value) => {
                  updateOption("entity", value)
                  updateOption("data", undefined)
                }}
              >
                <Select.Trigger>
                  <Select.Value placeholder={metadataLoading ? "Loading..." : "Select entity..."} />
                </Select.Trigger>
                <Select.Content>
                  {entities.filter((e: EntityMetadata) => e.queryable).length > 0 ? (
                    <>
                      {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Custom Modules</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                      {entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Core Entities</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                    </>
                  ) : (
                    <Text className="px-2 py-2 text-ui-fg-muted">No entities available</Text>
                  )}
                </Select.Content>
              </Select>
            </div>

            {/* Show available fields for the selected entity */}
            {options.entity && entityFields.length > 0 && (
              <div>
                <Label>Available Fields</Label>
                <div className="mt-1 max-h-24 overflow-y-auto border rounded p-2 text-xs">
                  {entityFields.filter((f: any) => f.name !== "id" && !f.name.endsWith("_at")).map((field: any) => (
                    <span key={field.name} className="inline-block mr-2 mb-1">
                      <Badge size="2xsmall" color="grey">{field.name}</Badge>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="data">Data (JSON)</Label>
              <Textarea
                id="data"
                value={typeof options.data === "string" ? options.data : JSON.stringify(options.data || {}, null, 2)}
                onChange={(e) => {
                  try {
                    updateOption("data", JSON.parse(e.target.value))
                  } catch {
                    updateOption("data", e.target.value)
                  }
                }}
                rows={6}
                className="font-mono text-xs"
                placeholder={`{
  "name": "{{ $trigger.name }}",
  "status": "active"
}`}
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Use {"{{ variable }}"} for dynamic values
              </Text>
            </div>
          </>
        )

      case "update_data":
        return (
          <>
            <div>
              <Label htmlFor="entity">Entity *</Label>
              <Select
                value={options.entity || ""}
                onValueChange={(value) => {
                  updateOption("entity", value)
                  updateOption("data", undefined)
                }}
              >
                <Select.Trigger>
                  <Select.Value placeholder={metadataLoading ? "Loading..." : "Select entity..."} />
                </Select.Trigger>
                <Select.Content>
                  {entities.filter((e: EntityMetadata) => e.queryable).length > 0 ? (
                    <>
                      {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Custom Modules</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                      {entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Core Entities</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                    </>
                  ) : (
                    <Text className="px-2 py-2 text-ui-fg-muted">No entities available</Text>
                  )}
                </Select.Content>
              </Select>
            </div>

            <div>
              <Label htmlFor="id">Record ID *</Label>
              <Input
                id="id"
                value={options.id || ""}
                onChange={(e) => updateOption("id", e.target.value)}
                placeholder="{{ $last.records[0].id }}"
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                ID of the record to update
              </Text>
            </div>

            {/* Show available fields for the selected entity */}
            {options.entity && entityFields.length > 0 && (
              <div>
                <Label>Updatable Fields</Label>
                <div className="mt-1 max-h-24 overflow-y-auto border rounded p-2 text-xs">
                  {entityFields.filter((f: any) => f.name !== "id" && !f.name.endsWith("_at")).map((field: any) => (
                    <span key={field.name} className="inline-block mr-2 mb-1">
                      <Badge size="2xsmall" color="grey">{field.name}</Badge>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="data">Update Data (JSON)</Label>
              <Textarea
                id="data"
                value={typeof options.data === "string" ? options.data : JSON.stringify(options.data || {}, null, 2)}
                onChange={(e) => {
                  try {
                    updateOption("data", JSON.parse(e.target.value))
                  } catch {
                    updateOption("data", e.target.value)
                  }
                }}
                rows={6}
                className="font-mono text-xs"
                placeholder={`{
  "status": "completed",
  "updated_by": "{{ $trigger.user_id }}"
}`}
              />
            </div>
          </>
        )

      case "delete_data":
        return (
          <>
            <div>
              <Label htmlFor="entity">Entity *</Label>
              <Select
                value={options.entity || ""}
                onValueChange={(value) => updateOption("entity", value)}
              >
                <Select.Trigger>
                  <Select.Value placeholder={metadataLoading ? "Loading..." : "Select entity..."} />
                </Select.Trigger>
                <Select.Content>
                  {entities.filter((e: EntityMetadata) => e.queryable).length > 0 ? (
                    <>
                      {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Custom Modules</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                      {entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Core Entities</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "core" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              {entity.name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                    </>
                  ) : (
                    <Text className="px-2 py-2 text-ui-fg-muted">No entities available</Text>
                  )}
                </Select.Content>
              </Select>
            </div>

            <div>
              <Label htmlFor="id">Record ID *</Label>
              <Input
                id="id"
                value={options.id || ""}
                onChange={(e) => updateOption("id", e.target.value)}
                placeholder="{{ $last.records[0].id }}"
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                ID of the record to delete
              </Text>
            </div>

            <div className="p-2 bg-ui-bg-subtle border border-ui-tag-red-border rounded">
              <Text className="text-xs text-ui-tag-red-text">
                ⚠️ This operation will permanently delete the record
              </Text>
            </div>
          </>
        )

      case "log":
        return (
          <div>
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={options.message || ""}
              onChange={(e) => updateOption("message", e.target.value)}
              rows={3}
              placeholder="Log message, use {{ $last }} for previous output"
            />
            <Text className="text-xs text-ui-fg-subtle mt-1">
              Use {"{{ $last }}"} to log the previous operation's output
            </Text>
          </div>
        )

      case "condition":
        return (
          <div>
            <Label htmlFor="expression">Condition Expression</Label>
            <Input
              id="expression"
              value={options.expression || ""}
              onChange={(e) => {
                const expression = e.target.value
                updateOption("expression", expression)

                const parsed = parseConditionExpressionToFilterRule(expression)
                if (parsed.error) {
                  setConditionExpressionError(parsed.error)
                  return
                }

                setConditionExpressionError(null)
                if (parsed.filterRule) {
                  updateOption("filter_rule", parsed.filterRule)
                }
              }}
              placeholder='e.g., extracted.object.email_type in ["order_received", "confirmation"]'
            />
            {conditionExpressionError && (
              <Text className="text-xs text-ui-fg-error mt-1">
                {conditionExpressionError}
              </Text>
            )}
            <Text className="text-xs text-ui-fg-subtle mt-1">
              Saved as <code className="bg-ui-bg-subtle px-1">filter_rule</code> for runtime branching
            </Text>
          </div>
        )

      case "http_request":
        const showBody = ["POST", "PUT", "PATCH"].includes(options.method || "GET")
        return (
          <>
            <div>
              <Label htmlFor="method">Method</Label>
              <Select
                value={options.method || "GET"}
                onValueChange={(value) => updateOption("method", value)}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="GET">GET</Select.Item>
                  <Select.Item value="POST">POST</Select.Item>
                  <Select.Item value="PUT">PUT</Select.Item>
                  <Select.Item value="PATCH">PATCH</Select.Item>
                  <Select.Item value="DELETE">DELETE</Select.Item>
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                value={options.url || ""}
                onChange={(e) => updateOption("url", e.target.value)}
                placeholder="https://api.example.com/endpoint"
              />
            </div>
            {showBody && (
              <div>
                <Label htmlFor="body">Request Body (JSON)</Label>
                <Textarea
                  id="body"
                  value={typeof options.body === "string" ? options.body : JSON.stringify(options.body || {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value)
                      updateOption("body", parsed)
                    } catch {
                      // Keep as string if not valid JSON
                      updateOption("body", e.target.value)
                    }
                  }}
                  rows={4}
                  className="font-mono text-xs"
                  placeholder={'{\n  "key": "{{ $last.value }}"\n}'}
                />
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  Leave empty to auto-send <code className="bg-ui-bg-subtle px-1">$last</code> as body
                </Text>
              </div>
            )}
            <div>
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                value={options.timeout_ms || 30000}
                onChange={(e) => updateOption("timeout_ms", parseInt(e.target.value) || 30000)}
              />
            </div>
          </>
        )

      case "transform":
        return (
          <div>
            <Label htmlFor="expression">Transform Expression</Label>
            <Textarea
              id="expression"
              value={options.expression || ""}
              onChange={(e) => updateOption("expression", e.target.value)}
              rows={3}
              placeholder="JavaScript expression to transform data"
            />
          </div>
        )

      case "send_email":
        return (
          <>
            <div>
              <Label htmlFor="to">To *</Label>
              <Input
                id="to"
                value={options.to || ""}
                onChange={(e) => updateOption("to", e.target.value)}
                placeholder="{{ $trigger.email }} or email@example.com"
              />
            </div>
            <div>
              <Label htmlFor="subject">Subject *</Label>
              <Input
                id="subject"
                value={options.subject || ""}
                onChange={(e) => updateOption("subject", e.target.value)}
                placeholder="Email subject"
              />
            </div>
            <div>
              <Label htmlFor="template">Template</Label>
              <Input
                id="template"
                value={options.template || ""}
                onChange={(e) => updateOption("template", e.target.value)}
                placeholder="Template name (optional)"
              />
            </div>
            <div>
              <Label htmlFor="body">Body</Label>
              <Textarea
                id="body"
                value={options.body || ""}
                onChange={(e) => updateOption("body", e.target.value)}
                rows={4}
                placeholder="Email body content..."
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Use {"{{ variable }}"} for dynamic content
              </Text>
            </div>
          </>
        )

      case "sleep":
        return (
          <div>
            <Label htmlFor="duration">Duration (ms)</Label>
            <Input
              id="duration"
              type="number"
              value={options.duration || 1000}
              onChange={(e) => updateOption("duration", parseInt(e.target.value) || 1000)}
            />
            <Text className="text-xs text-ui-fg-subtle mt-1">
              Pause execution for the specified duration
            </Text>
          </div>
        )

      case "notification":
        return (
          <>
            <div>
              <Label htmlFor="channel">Channel</Label>
              <Select
                value={options.channel || "email"}
                onValueChange={(value) => updateOption("channel", value)}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="email">Email</Select.Item>
                  <Select.Item value="sms">SMS</Select.Item>
                  <Select.Item value="push">Push Notification</Select.Item>
                  <Select.Item value="slack">Slack</Select.Item>
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label htmlFor="to">Recipient *</Label>
              <Input
                id="to"
                value={options.to || ""}
                onChange={(e) => updateOption("to", e.target.value)}
                placeholder="{{ $trigger.user_id }} or identifier"
              />
            </div>
            <div>
              <Label htmlFor="message">Message *</Label>
              <Textarea
                id="message"
                value={options.message || ""}
                onChange={(e) => updateOption("message", e.target.value)}
                rows={3}
                placeholder="Notification message..."
              />
            </div>
            <div>
              <Label htmlFor="data">Additional Data (JSON)</Label>
              <Textarea
                id="data"
                value={typeof options.data === "string" ? options.data : JSON.stringify(options.data || {}, null, 2)}
                onChange={(e) => {
                  try {
                    updateOption("data", JSON.parse(e.target.value))
                  } catch {
                    updateOption("data", e.target.value)
                  }
                }}
                rows={3}
                className="font-mono text-xs"
                placeholder='{ "action_url": "{{ $trigger.url }}" }'
              />
            </div>
          </>
        )

      case "execute_code":
        const currentPackages: string[] = options.packages || []
        
        return (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="code">JavaScript Code</Label>
                <CodeEditorModal
                  code={options.code || ""}
                  onChange={(code) => updateOption("code", code)}
                  packages={currentPackages}
                  onPackagesChange={(packages) => updateOption("packages", packages)}
                  flowId={flowId}
                  operationKey={operationKey}
                  availableOperationKeys={availableOperationKeys}
                  variableSuggestions={variableSuggestions}
                />
              </div>
              <Textarea
                id="code"
                value={options.code || ""}
                onChange={(e) => updateOption("code", e.target.value)}
                rows={8}
                className="font-mono text-xs"
                placeholder={`// Access previous output with $last
// Access all data with $input
// Return your result

const data = $last || {}
return {
  processed: true,
  data
}`}
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                <strong>Built-in:</strong> <code className="bg-ui-bg-subtle px-1">_</code> (lodash), <code className="bg-ui-bg-subtle px-1">dayjs</code>, <code className="bg-ui-bg-subtle px-1">uuid</code>, <code className="bg-ui-bg-subtle px-1">validator</code>, <code className="bg-ui-bg-subtle px-1">crypto</code>, <code className="bg-ui-bg-subtle px-1">fetch</code>
              </Text>
            </div>
            
            {/* External Packages */}
            <div>
              <Label htmlFor="packages">NPM Packages</Label>
              <Input
                id="packages"
                value={currentPackages.join(", ")}
                onChange={(e) => {
                  const value = e.target.value
                  const packages = value
                    .split(/[,\s]+/)
                    .map(p => p.trim())
                    .filter(p => p.length > 0)
                  updateOption("packages", packages)
                }}
                placeholder="lodash, axios, moment..."
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Enter any npm package name. Packages are auto-installed on first use.
              </Text>
              {currentPackages.length > 0 && (
                <div className="mt-2">
                  <Text className="text-xs text-ui-fg-muted">
                    <strong>Will load:</strong>
                  </Text>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {currentPackages.map((pkg) => (
                      <span 
                        key={pkg}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-ui-bg-subtle rounded border border-ui-border-base"
                      >
                        {pkg}
                        <button
                          type="button"
                          onClick={() => {
                            updateOption("packages", currentPackages.filter(p => p !== pkg))
                          }}
                          className="text-ui-fg-muted hover:text-ui-fg-base"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <Text className="text-xs text-ui-fg-muted mt-1">
                    Access as: {currentPackages.map(p => p.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "")).join(", ")}
                  </Text>
                </div>
              )}
            </div>
            
            <div>
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                value={options.timeout || 5000}
                onChange={(e) => updateOption("timeout", parseInt(e.target.value) || 5000)}
              />
            </div>
          </>
        )

      case "bulk_update_data":
        const itemsRaw = options.items
        const itemsAsString =
          typeof itemsRaw === "string"
            ? itemsRaw
            : JSON.stringify(itemsRaw || [], null, 2)

        const selectedVar = (() => {
          if (typeof itemsRaw !== "string") return ""
          const m = itemsRaw.match(/^\{\{\s*([^}]+)\s*\}\}$/)
          return m?.[1] ? `{{ ${m[1].trim()} }}` : ""
        })()

        return (
          <>
            <div>
              <Label htmlFor="module">Module *</Label>
              <Input
                id="module"
                value={options.module || ""}
                onChange={(e) => updateOption("module", e.target.value)}
                placeholder="product"
              />
            </div>

            <div>
              <Label htmlFor="collection">Collection *</Label>
              <Input
                id="collection"
                value={options.collection || ""}
                onChange={(e) => updateOption("collection", e.target.value)}
                placeholder="products"
              />
            </div>

            <div>
              <Label>Items source</Label>
              <Select
                value={selectedVar || undefined}
                onValueChange={(v) => {
                  updateOption("items", v)
                }}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Select a previous output…" />
                </Select.Trigger>
                <Select.Content className="max-h-64 overflow-y-auto">
                  {variableSuggestions.map((it) => (
                    <Select.Item key={it.value} value={it.value}>
                      {it.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div>
              <Label htmlFor="items">Items (JSON or {"{{ variable }}"})</Label>
              <Textarea
                id="items"
                value={itemsAsString}
                onChange={(e) => {
                  const val = e.target.value
                  try {
                    updateOption("items", JSON.parse(val))
                  } catch {
                    updateOption("items", val)
                  }
                }}
                rows={8}
                className="font-mono text-xs"
                placeholder="{{ build_updates.items }}"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={options.continue_on_error !== false}
                onCheckedChange={(checked) => updateOption("continue_on_error", Boolean(checked))}
              />
              <Text className="text-xs text-ui-fg-subtle">Continue on error</Text>
            </div>

            <div>
              <Label htmlFor="max_items">Max items</Label>
              <Input
                id="max_items"
                type="number"
                value={options.max_items || 200}
                onChange={(e) => updateOption("max_items", parseInt(e.target.value) || 200)}
              />
            </div>
          </>
        )

      case "trigger_workflow":
        // Support both workflow_name (new) and workflow_id (legacy)
        const workflowValue = options.workflow_name || options.workflow_id || ""
        const selectedWorkflow = workflows.find((w: any) => w.name === workflowValue)
        // Group workflows by category
        const workflowsByCategory = workflows.reduce((acc: Record<string, any[]>, wf: any) => {
          const cat = wf.category || "general"
          if (!acc[cat]) acc[cat] = []
          acc[cat].push(wf)
          return acc
        }, {})
        
        return (
          <>
            <div>
              <Label htmlFor="workflow">Workflow</Label>
              {metadataLoading ? (
                <Text size="small" className="text-ui-fg-muted py-2">Loading workflows...</Text>
              ) : workflows.length === 0 ? (
                <Text size="small" className="text-ui-fg-muted py-2">No workflows found</Text>
              ) : (
                <StackedFocusModal id="workflow-picker">
                  <StackedFocusModal.Trigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-sm border border-ui-border-base rounded-md bg-ui-bg-field hover:bg-ui-bg-field-hover text-left"
                    >
                      <span className={workflowValue ? "text-ui-fg-base" : "text-ui-fg-muted"}>
                        {workflowValue || "Select workflow..."}
                      </span>
                      <MagnifyingGlass className="text-ui-fg-muted w-4 h-4 shrink-0" />
                    </button>
                  </StackedFocusModal.Trigger>
                  <StackedFocusModal.Content>
                    <StackedFocusModal.Header>
                      <Text weight="plus">Select Workflow</Text>
                    </StackedFocusModal.Header>
                    <div className="px-4 py-3 border-b border-ui-border-base">
                      <div className="relative">
                        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-ui-fg-muted w-4 h-4" />
                        <Input
                          autoFocus
                          value={workflowSearch}
                          onChange={(e) => setWorkflowSearch(e.target.value)}
                          placeholder="Search workflows..."
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <StackedFocusModal.Body className="p-0 overflow-y-auto max-h-[60vh]">
                      {(() => {
                        const q = workflowSearch.toLowerCase()
                        const filtered = workflows.filter((wf: any) =>
                          !q ||
                          wf.name?.toLowerCase().includes(q) ||
                          wf.description?.toLowerCase().includes(q) ||
                          wf.category?.toLowerCase().includes(q)
                        )
                        const grouped = filtered.reduce((acc: Record<string, any[]>, wf: any) => {
                          const cat = wf.category || "general"
                          if (!acc[cat]) acc[cat] = []
                          acc[cat].push(wf)
                          return acc
                        }, {})

                        if (filtered.length === 0) {
                          return (
                            <div className="flex items-center justify-center py-12">
                              <Text className="text-ui-fg-muted">No workflows match "{workflowSearch}"</Text>
                            </div>
                          )
                        }

                        return Object.entries(grouped).map(([category, wfs]) => (
                          <div key={category}>
                            <div className="px-4 py-2 bg-ui-bg-subtle border-b border-ui-border-base sticky top-0">
                              <Text className="text-xs font-medium text-ui-fg-muted uppercase tracking-wide capitalize">{category}</Text>
                            </div>
                            {(wfs as any[]).map((wf: any) => (
                              <StackedFocusModal.Close key={wf.name} asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateOptions({
                                      workflow_name: wf.name,
                                      workflow_id: undefined,
                                      input: {},
                                    })
                                    setWorkflowSearch("")
                                  }}
                                  className={[
                                    "w-full text-left px-4 py-3 border-b border-ui-border-base",
                                    "hover:bg-ui-bg-subtle transition-colors",
                                    wf.name === workflowValue ? "bg-ui-bg-highlight" : "",
                                  ].join(" ")}
                                >
                                  <Text className="text-sm font-medium text-ui-fg-base">{wf.name}</Text>
                                  {wf.description && (
                                    <Text className="text-xs text-ui-fg-subtle mt-0.5 line-clamp-1">{wf.description}</Text>
                                  )}
                                  {wf.requiredModules?.length > 0 && (
                                    <div className="flex gap-1 mt-1 flex-wrap">
                                      {wf.requiredModules.map((m: string) => (
                                        <Badge key={m} size="2xsmall" color="grey">{m}</Badge>
                                      ))}
                                    </div>
                                  )}
                                </button>
                              </StackedFocusModal.Close>
                            ))}
                          </div>
                        ))
                      })()}
                    </StackedFocusModal.Body>
                  </StackedFocusModal.Content>
                </StackedFocusModal>
              )}
              {selectedWorkflow && (
                <div className="mt-2 text-xs space-y-1">
                  <Text className="text-ui-fg-subtle">{selectedWorkflow.description}</Text>
                  {selectedWorkflow.steps && selectedWorkflow.steps.length > 0 && (
                    <div className="mt-1">
                      <Text className="text-ui-fg-muted">Steps: </Text>
                      <Text className="text-ui-fg-subtle">{selectedWorkflow.steps.slice(0, 3).join(" → ")}{selectedWorkflow.steps.length > 3 ? "..." : ""}</Text>
                    </div>
                  )}
                  {selectedWorkflow.requiredModules && selectedWorkflow.requiredModules.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-1">
                      {selectedWorkflow.requiredModules.map((mod: string) => (
                        <Badge key={mod} size="2xsmall" color="grey">{mod}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Field mapper / JSON toggle */}
            {(() => {
              const fields: WorkflowInputField[] = selectedWorkflow?.inputSchema || []
              const inputObj: Record<string, any> =
                typeof options.input === "object" && options.input !== null
                  ? options.input
                  : {}

              const setField = (name: string, value: string) => {
                updateOption("input", { ...inputObj, [name]: value })
              }

              const TYPE_COLORS: Record<string, "blue" | "green" | "orange" | "purple" | "grey"> = {
                string: "blue", number: "green", boolean: "orange",
                date: "purple", array: "grey", object: "grey", id: "grey",
              }

              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Workflow Input</Label>
                    <button
                      type="button"
                      onClick={() => setShowRawWorkflowJson((v) => !v)}
                      className="text-xs text-ui-fg-interactive hover:underline"
                    >
                      {showRawWorkflowJson ? "Field mapper" : "Raw JSON"}
                    </button>
                  </div>

                  {showRawWorkflowJson ? (
                    <div>
                      <Textarea
                        value={typeof options.input === "string" ? options.input : JSON.stringify(options.input || {}, null, 2)}
                        onChange={(e) => {
                          try { updateOption("input", JSON.parse(e.target.value)) }
                          catch { updateOption("input", e.target.value) }
                        }}
                        rows={8}
                        className="font-mono text-xs"
                        placeholder={'{\n  "id": "{{ $last.id }}"\n}'}
                      />
                      <Text className="text-xs text-ui-fg-subtle mt-1">
                        Use {"{{ step_key.field }}"} for dynamic values
                      </Text>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {fields.map((field) => (
                        <div key={field.name} className="border border-ui-border-base rounded-md px-3 py-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <Text className="text-xs font-mono font-medium text-ui-fg-base flex-1">
                              {field.name}
                            </Text>
                            <Badge size="2xsmall" color={TYPE_COLORS[field.type] ?? "grey"}>
                              {field.type}
                            </Badge>
                            {field.required && (
                              <Badge size="2xsmall" color="orange">required</Badge>
                            )}
                          </div>
                          {field.description && (
                            <Text className="text-xs text-ui-fg-subtle">{field.description}</Text>
                          )}
                          <Input
                            value={inputObj[field.name] !== undefined
                              ? (typeof inputObj[field.name] === "object"
                                  ? JSON.stringify(inputObj[field.name])
                                  : String(inputObj[field.name]))
                              : ""}
                            onChange={(e) => setField(field.name, e.target.value)}
                            placeholder={field.placeholder ?? `{{ $last.${field.name} }}`}
                            className="text-xs font-mono mt-1"
                          />
                        </div>
                      ))}
                      {fields.length === 0 && (
                        <Text className="text-xs text-ui-fg-subtle italic">
                          No input schema defined for this workflow.
                        </Text>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )

      case "trigger_flow":
        const triggerableFlows = metadata?.triggerableFlows || []
        const selectedFlow = triggerableFlows.find((f: any) => f.id === options.flow_id)
        
        return (
          <>
            <div>
              <Label htmlFor="flow">Flow to Trigger</Label>
              {metadataLoading ? (
                <Text size="small" className="text-ui-fg-muted py-2">Loading flows...</Text>
              ) : triggerableFlows.length === 0 ? (
                <Text size="small" className="text-ui-fg-muted py-2">
                  No flows available. Create a flow with trigger type "Another Flow" first.
                </Text>
              ) : (
                <Select
                  value={options.flow_id || undefined}
                  onValueChange={(value) => {
                    const flow = triggerableFlows.find((f: any) => f.id === value)
                    updateOptions({
                      flow_id: value,
                      flow_name: flow?.name || "",
                    })
                  }}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select flow to trigger..." />
                  </Select.Trigger>
                  <Select.Content className="max-h-64 overflow-y-auto">
                    {triggerableFlows.map((flow: any) => (
                      <Select.Item key={flow.id} value={flow.id}>
                        <div className="flex flex-col">
                          <span>{flow.name}</span>
                          <span className="text-xs text-ui-fg-subtle">
                            {flow.trigger_type} • {flow.status}
                          </span>
                        </div>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
              {selectedFlow && (
                <div className="mt-2 text-xs space-y-1">
                  {selectedFlow.description && (
                    <Text className="text-ui-fg-subtle">{selectedFlow.description}</Text>
                  )}
                  <div className="flex gap-2">
                    <Badge size="2xsmall" color={selectedFlow.status === "active" ? "green" : "grey"}>
                      {selectedFlow.status}
                    </Badge>
                    <Badge size="2xsmall" color="blue">
                      {selectedFlow.trigger_type}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="flow_input">Input Data (JSON)</Label>
              <Textarea
                id="flow_input"
                value={typeof options.input === "string" ? options.input : JSON.stringify(options.input || {}, null, 2)}
                onChange={(e) => {
                  try {
                    updateOption("input", JSON.parse(e.target.value))
                  } catch {
                    updateOption("input", e.target.value)
                  }
                }}
                rows={6}
                className="font-mono text-xs"
                placeholder={'{\n  "id": "{{ $last.id }}",\n  "data": "{{ $trigger }}"\n}'}
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Data passed to the triggered flow as $trigger
              </Text>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="wait_for_completion"
                checked={options.wait_for_completion !== false}
                onCheckedChange={(checked) => updateOption("wait_for_completion", checked)}
              />
              <Label htmlFor="wait_for_completion" className="cursor-pointer">
                Wait for completion
              </Label>
            </div>
          </>
        )

      case "ai_extract": {
        const schemaFields: Array<{ name: string; type: string; description?: string; enumValues?: string[]; required?: boolean }> = options.schema_fields || []

        const addField = () => {
          updateOption("schema_fields", [
            ...schemaFields,
            { name: "", type: "string", required: false },
          ])
        }

        const removeField = (idx: number) => {
          updateOption("schema_fields", schemaFields.filter((_: any, i: number) => i !== idx))
        }

        const updateField = (idx: number, patch: Record<string, any>) => {
          updateOption(
            "schema_fields",
            schemaFields.map((f: any, i: number) => (i === idx ? { ...f, ...patch } : f))
          )
        }

        return (
          <>
            {/* Model */}
            <div>
              <Label htmlFor="ai_model">Model</Label>
              <Select
                value={options.model || "google/gemini-2.0-flash-exp:free"}
                onValueChange={(value) => updateOption("model", value)}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content className="max-h-72 overflow-y-auto">
                  <Select.Group>
                    <Text className="px-2 py-1 text-xs text-ui-fg-muted">Free models</Text>
                    <Select.Item value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash Exp · 1M ctx (free)</Select.Item>
                    <Select.Item value="google/gemma-3-27b-it:free">Gemma 3 27B · 131k ctx (free)</Select.Item>
                    <Select.Item value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B · 131k ctx (free)</Select.Item>
                    <Select.Item value="mistralai/mistral-small-3.1-24b-instruct:free">Mistral Small 3.1 24B · 128k ctx (free)</Select.Item>
                    <Select.Item value="qwen/qwen3-4b:free">Qwen3 4B · 128k ctx (free)</Select.Item>
                    <Select.Item value="qwen/qwen3-coder:free">Qwen3 Coder 480B · 1M ctx (free)</Select.Item>
                    <Select.Item value="qwen/qwen3-next-80b-a3b-instruct:free">Qwen3 Next 80B · 262k ctx (free)</Select.Item>
                    <Select.Item value="openai/gpt-oss-120b:free">OpenAI OSS 120B · 131k ctx (free)</Select.Item>
                    <Select.Item value="openai/gpt-oss-20b:free">OpenAI OSS 20B · 131k ctx (free)</Select.Item>
                    <Select.Item value="nvidia/nemotron-3-nano-30b-a3b:free">Nemotron 3 Nano 30B · 256k ctx (free)</Select.Item>
                    <Select.Item value="nvidia/nemotron-nano-12b-v2-vl:free">Nemotron Nano 12B VL · 128k ctx (free)</Select.Item>
                    <Select.Item value="nvidia/nemotron-nano-9b-v2:free">Nemotron Nano 9B · 32k ctx (free)</Select.Item>
                    <Select.Item value="z-ai/glm-4.5-air:free">GLM 4.5 Air · 131k ctx (free)</Select.Item>
                    <Select.Item value="arcee-ai/trinity-large-preview:free">Trinity Large Preview · 131k ctx (free)</Select.Item>
                    <Select.Item value="arcee-ai/trinity-mini:free">Trinity Mini · 131k ctx (free)</Select.Item>
                    <Select.Item value="stepfun/step-3.5-flash:free">Step 3.5 Flash · 256k ctx (free)</Select.Item>
                    <Select.Item value="liquid/lfm-2.5-1.2b-instruct:free">LFM2.5 1.2B Instruct · 32k ctx (free)</Select.Item>
                  </Select.Group>
                  <Select.Group>
                    <Text className="px-2 py-1 text-xs text-ui-fg-muted">Paid models</Text>
                    <Select.Item value="google/gemini-2.5-pro-exp-03-25">Gemini 2.5 Pro</Select.Item>
                    <Select.Item value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</Select.Item>
                    <Select.Item value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku</Select.Item>
                    <Select.Item value="openai/gpt-4o-mini">GPT-4o Mini</Select.Item>
                    <Select.Item value="openai/gpt-4o">GPT-4o</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select>
            </div>

            {/* System Prompt */}
            <div>
              <Label htmlFor="system_prompt">System Prompt</Label>
              <Textarea
                id="system_prompt"
                value={options.system_prompt || ""}
                onChange={(e) => updateOption("system_prompt", e.target.value)}
                rows={3}
                placeholder="Extract order info from this vendor email. Be precise and return null for missing fields."
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Instructions for the model on how to extract data
              </Text>
            </div>

            {/* Input */}
            <div>
              <Label htmlFor="ai_input">Input</Label>
              <Textarea
                id="ai_input"
                value={options.input || ""}
                onChange={(e) => updateOption("input", e.target.value)}
                rows={3}
                placeholder={"Subject: {{ $trigger.subject }}\n\n{{ $trigger.html_body }}"}
                className="font-mono text-xs"
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Text sent to the model. Use {"{{ variable }}"} for dynamic values.
              </Text>
            </div>

            {/* Schema Fields */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Fields to Extract</Label>
                <Button variant="secondary" size="small" onClick={addField}>
                  + Add Field
                </Button>
              </div>

              {schemaFields.length === 0 && (
                <Text className="text-xs text-ui-fg-subtle italic">
                  No fields defined. Add fields to extract structured data.
                </Text>
              )}

              <div className="space-y-2">
                {schemaFields.map((field: any, idx: number) => (
                  <div key={idx} className="border border-ui-border-base rounded-md p-2 space-y-2">
                    {/* Row 1: name + type + required + remove */}
                    <div className="flex items-center gap-2">
                      <Input
                        value={field.name}
                        onChange={(e) => updateField(idx, { name: e.target.value })}
                        placeholder="field_name"
                        className="flex-1 text-xs font-mono"
                      />
                      <Select
                        value={field.type || "string"}
                        onValueChange={(value) => updateField(idx, { type: value, enumValues: undefined })}
                      >
                        <Select.Trigger className="w-28">
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="string">string</Select.Item>
                          <Select.Item value="number">number</Select.Item>
                          <Select.Item value="boolean">boolean</Select.Item>
                          <Select.Item value="enum">enum</Select.Item>
                          <Select.Item value="array">array</Select.Item>
                          <Select.Item value="object">object</Select.Item>
                        </Select.Content>
                      </Select>
                      <div className="flex items-center gap-1">
                        <Checkbox
                          id={`field-required-${idx}`}
                          checked={!!field.required}
                          onCheckedChange={(checked) => updateField(idx, { required: !!checked })}
                        />
                        <Text className="text-xs text-ui-fg-subtle">req</Text>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeField(idx)}
                        className="text-ui-fg-muted hover:text-ui-fg-error text-sm leading-none"
                      >
                        ×
                      </button>
                    </div>

                    {/* Enum values */}
                    {field.type === "enum" && (
                      <div>
                        <Input
                          value={(field.enumValues || []).join(", ")}
                          onChange={(e) => {
                            const vals = e.target.value
                              .split(",")
                              .map((v: string) => v.trim())
                              .filter((v: string) => v.length > 0)
                            updateField(idx, { enumValues: vals })
                          }}
                          placeholder="value1, value2, value3"
                          className="text-xs font-mono"
                        />
                        <Text className="text-xs text-ui-fg-subtle mt-0.5">Comma-separated enum values</Text>
                      </div>
                    )}

                    {/* Description */}
                    <Input
                      value={field.description || ""}
                      onChange={(e) => updateField(idx, { description: e.target.value })}
                      placeholder="Optional: hint for the model"
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Fallback on error */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="fallback_on_error"
                checked={!!options.fallback_on_error}
                onCheckedChange={(checked) => updateOption("fallback_on_error", !!checked)}
              />
              <Label htmlFor="fallback_on_error" className="cursor-pointer">
                Return empty object on error (don't fail flow)
              </Label>
            </div>
          </>
        )
      }

      default:
        return null
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <Heading level="h2" className="text-sm">Properties</Heading>
        <IconButton variant="transparent" size="small" onClick={onClose}>
          <XMark />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isTrigger ? (
          <>
            <div>
              <Text weight="plus" className="text-sm mb-1">Trigger Type</Text>
              <Text className="text-ui-fg-subtle capitalize">
                {String(node.data.triggerType || "").replace(/_/g, " ")}
              </Text>
            </div>
            
            {/* Show webhook URL for webhook triggers */}
            {node.data.triggerType === "webhook" && flowId && (
              <div>
                <Text weight="plus" className="text-sm mb-1">Webhook URL</Text>
                <div className="flex items-center gap-2">
                  <Input
                    value={`${window.location.origin}/webhooks/flows/${flowId}`}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/webhooks/flows/${flowId}`)
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  Send POST requests to this URL to trigger the flow
                </Text>
              </div>
            )}
            
            {/* Show event type for event triggers */}
            {node.data.triggerType === "event" && (
              <div>
                <Text weight="plus" className="text-sm mb-1">Event Type</Text>
                <Text className="text-ui-fg-subtle font-mono text-sm">
                  {(node.data.triggerConfig as any)?.event_type || "Not configured"}
                </Text>
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  Flow will trigger when this Medusa event is emitted
                </Text>
              </div>
            )}
            
            {/* Show schedule for scheduled triggers */}
            {node.data.triggerType === "schedule" && (
              <div>
                <Text weight="plus" className="text-sm mb-1">Schedule (Cron)</Text>
                <Text className="text-ui-fg-subtle font-mono text-sm">
                  {(node.data.triggerConfig as any)?.cron || "Not configured"}
                </Text>
              </div>
            )}
            
            <div>
              <Text weight="plus" className="text-sm mb-1">Configuration</Text>
              <pre className="text-xs bg-ui-bg-subtle p-2 rounded overflow-auto max-h-32">
                {JSON.stringify(node.data.triggerConfig || {}, null, 2)}
              </pre>
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="label">Display Name</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Operation name"
              />
            </div>

            <div>
              <Label htmlFor="operationKey">Operation Key</Label>
              <Input
                id="operationKey"
                value={operationKey}
                onChange={(e) => setOperationKey(e.target.value)}
                placeholder="unique_key"
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Used to reference this operation's output
              </Text>
            </div>

            <div>
              <Text weight="plus" className="text-sm mb-1">Operation Type</Text>
              <Text className="text-ui-fg-subtle">{operationType}</Text>
            </div>

            {/* Operation-specific fields */}
            {!showAdvanced && renderOperationFields()}

            {/* Advanced JSON editor toggle */}
            <div className="pt-2">
              <Button
                variant="transparent"
                size="small"
                onClick={() => {
                  setShowAdvanced(!showAdvanced)
                  if (!showAdvanced) {
                    setAdvancedJson(JSON.stringify(options, null, 2))
                  }
                }}
              >
                {showAdvanced ? "← Simple Mode" : "Advanced (JSON) →"}
              </Button>
            </div>

            {showAdvanced && (
              <div>
                <Label htmlFor="options">Options (JSON)</Label>
                <Textarea
                  id="options"
                  value={advancedJson}
                  onChange={(e) => setAdvancedJson(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
                {jsonError && (
                  <Text className="text-ui-fg-error text-xs mt-1">
                    {jsonError}
                  </Text>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} className="flex-1">
                Apply Changes
              </Button>
              <Button variant="danger" onClick={onDelete}>
                <Trash />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
