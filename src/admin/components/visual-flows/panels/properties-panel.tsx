import { Text, Heading, IconButton, Button, Input, Label, Textarea, Select, Checkbox, Badge } from "@medusajs/ui"
import { XMark, Trash } from "@medusajs/icons"
import { Edge, Node } from "@xyflow/react"
import { useState, useEffect, useMemo } from "react"
import { useFlowMetadata, EntityMetadata } from "../../../hooks/api/visual-flows"
import { CodeEditorModal } from "../code-editor-modal"

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

  useEffect(() => {
    setLabel(String(node.data.label || ""))
    setOperationKey(String(node.data.operationKey || ""))
    setOptions(node.data.options || {})
    setAdvancedJson(JSON.stringify(node.data.options || {}, null, 2))
    setJsonError(null)
    setConditionExpressionError(null)
  }, [node.id, node.data])

  const parseConditionExpressionToFilterRule = (raw: string): {
    filterRule?: Record<string, any>
    error?: string
  } => {
    const trimmed = String(raw || "").trim()
    if (!trimmed) {
      return { filterRule: {} }
    }

    const withoutMustache = trimmed.replace(/^\{\{\s*|\s*\}\}$/g, "").trim()
    const match = withoutMustache.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
    if (!match) {
      return {
        error:
          "Unsupported expression. Use a simple comparison like $last.count > 0 or {{ $last.count }} > 0.",
      }
    }

    const stripMustache = (value: string) => {
      const v = value.trim()
      const m = v.match(/^\{\{\s*([^}]+)\s*\}\}$/)
      return m ? m[1].trim() : v
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
      return newOptions
    })
  }

  const handleSave = () => {
    if (showAdvanced) {
      try {
        const parsedOptions = JSON.parse(advancedJson)
        setJsonError(null)
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
              placeholder="e.g., $last.count > 0"
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
        
        // Infer input schema from workflow name patterns
        const inferInputSchema = (workflowName: string): { fields: string[], example: Record<string, any> } => {
          const name = workflowName.toLowerCase()
          
          // Common patterns for workflow inputs
          if (name.includes("create-")) {
            const entity = name.replace("create-", "").replace(/-/g, "_")
            return {
              fields: ["name", "data"],
              example: { name: `New ${entity}`, data: "{ ... }" }
            }
          }
          if (name.includes("update-") || name.includes("edit-")) {
            return {
              fields: ["id", "data"],
              example: { id: "{{ $last.id }}", data: "{ ... }" }
            }
          }
          if (name.includes("delete-") || name.includes("remove-")) {
            return {
              fields: ["id"],
              example: { id: "{{ $last.id }}" }
            }
          }
          if (name.includes("send-") || name.includes("email")) {
            return {
              fields: ["to", "subject", "template"],
              example: { to: "{{ $trigger.email }}", subject: "Notification", template: "default" }
            }
          }
          if (name.includes("assign-")) {
            return {
              fields: ["id", "assignee_id"],
              example: { id: "{{ $last.id }}", assignee_id: "{{ $trigger.user_id }}" }
            }
          }
          if (name.includes("complete-") || name.includes("finish-")) {
            return {
              fields: ["id"],
              example: { id: "{{ $last.id }}" }
            }
          }
          if (name.includes("list-") || name.includes("get-")) {
            return {
              fields: ["filters", "limit"],
              example: { filters: {}, limit: 100 }
            }
          }
          // Default - just id
          return {
            fields: ["id"],
            example: { id: "{{ $last.id }}" }
          }
        }
        
        const inferredSchema = selectedWorkflow ? inferInputSchema(selectedWorkflow.name) : null
        
        return (
          <>
            <div>
              <Label htmlFor="workflow">Workflow</Label>
              {metadataLoading ? (
                <Text size="small" className="text-ui-fg-muted py-2">Loading workflows...</Text>
              ) : workflows.length === 0 ? (
                <Text size="small" className="text-ui-fg-muted py-2">No workflows found</Text>
              ) : (
                <Select
                  value={workflowValue || undefined}
                  onValueChange={(value) => {
                    // Auto-populate input with inferred schema
                    const wf = workflows.find((w: any) => w.name === value)
                    const schema = wf ? inferInputSchema(wf.name) : null
                    
                    // Update all options at once to avoid race condition
                    updateOptions({
                      workflow_name: value,
                      workflow_id: undefined, // Clear legacy field
                      ...(schema ? { input: schema.example } : {})
                    })
                  }}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Select workflow..." />
                  </Select.Trigger>
                  <Select.Content className="max-h-64 overflow-y-auto">
                    {Object.entries(workflowsByCategory).map(([category, wfs]) => (
                      <Select.Group key={category}>
                        <Text className="px-2 py-1 text-xs text-ui-fg-muted capitalize">{category}</Text>
                        {(wfs as any[]).map((wf: any) => (
                          <Select.Item key={wf.name} value={wf.name}>
                            {wf.name}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    ))}
                  </Select.Content>
                </Select>
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

            {/* Inferred input fields */}
            {inferredSchema && inferredSchema.fields.length > 0 && (
              <div>
                <Label>Expected Input Fields</Label>
                <div className="mt-1 flex gap-1 flex-wrap">
                  {inferredSchema.fields.map((field: string) => (
                    <Badge key={field} size="2xsmall" color="blue">{field}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="input">Workflow Input (JSON)</Label>
              <Textarea
                id="input"
                value={typeof options.input === "string" ? options.input : JSON.stringify(options.input || {}, null, 2)}
                onChange={(e) => {
                  try {
                    updateOption("input", JSON.parse(e.target.value))
                  } catch {
                    // Keep as string if not valid JSON
                    updateOption("input", e.target.value)
                  }
                }}
                rows={6}
                className="font-mono text-xs"
                placeholder={inferredSchema ? JSON.stringify(inferredSchema.example, null, 2) : '{ "id": "{{ $last.id }}" }'}
              />
              <Text className="text-xs text-ui-fg-subtle mt-1">
                Use {"{{ $last.field }}"} or {"{{ $trigger.field }}"} for dynamic values
              </Text>
            </div>
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
