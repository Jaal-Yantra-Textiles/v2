import { Text, Heading, IconButton, Button, Input, Label, Textarea, Select, Checkbox, Badge } from "@medusajs/ui"
import { XMark, Trash } from "@medusajs/icons"
import { Node } from "@xyflow/react"
import { useState, useEffect, useMemo } from "react"
import { useFlowMetadata, EntityMetadata } from "../../../hooks/api/visual-flows"
import { CodeEditorModal } from "../code-editor-modal"

interface PropertiesPanelProps {
  node: Node
  flowId?: string
  onUpdate: (data: Record<string, any>) => void
  onDelete: () => void
  onClose: () => void
}

export function PropertiesPanel({ node, flowId, onUpdate, onDelete, onClose }: PropertiesPanelProps) {
  const { data: metadata, isLoading: metadataLoading } = useFlowMetadata()
  const [label, setLabel] = useState(String(node.data.label || ""))
  const [operationKey, setOperationKey] = useState(String(node.data.operationKey || ""))
  const [options, setOptions] = useState<Record<string, any>>(node.data.options || {})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedJson, setAdvancedJson] = useState("")
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Get entities from metadata
  const entities = metadata?.entities || []
  const workflows = metadata?.workflows || []
  
  // Get selected entity's fields
  const selectedEntity = useMemo(() => {
    return entities.find((e: EntityMetadata) => e.name === options.entity)
  }, [entities, options.entity])
  
  const entityFields = selectedEntity?.fields || []
  const filterableFields = entityFields.filter((f: any) => f.filterable)

  useEffect(() => {
    setLabel(String(node.data.label || ""))
    setOperationKey(String(node.data.operationKey || ""))
    setOptions(node.data.options || {})
    setAdvancedJson(JSON.stringify(node.data.options || {}, null, 2))
    setJsonError(null)
  }, [node.id, node.data])

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
                      {/* Custom entities first - only queryable ones */}
                      {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).length > 0 && (
                        <Select.Group>
                          <Text className="px-2 py-1 text-xs text-ui-fg-muted">Custom Modules</Text>
                          {entities.filter((e: EntityMetadata) => e.type === "custom" && e.queryable).map((entity: EntityMetadata) => (
                            <Select.Item key={entity.name} value={entity.name}>
                              <span>{entity.name}</span>
                            </Select.Item>
                          ))}
                        </Select.Group>
                      )}
                      {/* Core entities - only queryable ones */}
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
              {options.entity && selectedEntity && (
                <Text className="text-xs text-ui-fg-subtle mt-1">
                  {selectedEntity.description}
                </Text>
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
                          const currentFields = options.fields || []
                          if (checked) {
                            updateOption("fields", [...currentFields, field.name])
                          } else {
                            updateOption("fields", currentFields.filter((f: string) => f !== field.name))
                          }
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
              onChange={(e) => updateOption("expression", e.target.value)}
              placeholder="e.g., {{ $last.count }} > 0"
            />
            <Text className="text-xs text-ui-fg-subtle mt-1">
              Expression that evaluates to true/false
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
        return (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="code">JavaScript Code</Label>
                <CodeEditorModal
                  code={options.code || ""}
                  onChange={(code) => updateOption("code", code)}
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
                Available: <code className="bg-ui-bg-subtle px-1">$last</code>, <code className="bg-ui-bg-subtle px-1">$input</code>, <code className="bg-ui-bg-subtle px-1">$trigger</code>, <code className="bg-ui-bg-subtle px-1">console.log</code>
              </Text>
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
