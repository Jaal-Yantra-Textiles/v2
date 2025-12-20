import React from "react"
import { Button, Input, Text, Textarea, Select } from "@medusajs/ui"
import { StackedFocusModal } from "../../modal/stacked-modal/stacked-focused-modal"
import { AdminEndpoint } from "../../../hooks/api/admin-catalog"

export const AdminApiModal: React.FC<{
    catalog: AdminEndpoint[]
    catalogSource: string
    apiSearch: string
    setApiSearch: (v: string) => void
    selectedEndpointId: string
    setSelectedEndpointId: (v: string) => void
    selected?: AdminEndpoint
    pathParamsJson: string
    setPathParamsJson: (v: string) => void
    queryJson: string
    setQueryJson: (v: string) => void
    bodyJson: string
    setBodyJson: (v: string) => void
    showJson: boolean
    setShowJson: (v: boolean) => void
    onRun: () => Promise<void>
    isRunning: boolean
}> = ({
    catalog,
    catalogSource,
    apiSearch,
    setApiSearch,
    selectedEndpointId,
    setSelectedEndpointId,
    selected,
    pathParamsJson,
    setPathParamsJson,
    queryJson,
    setQueryJson,
    bodyJson,
    setBodyJson,
    showJson,
    setShowJson,
    onRun,
    isRunning,
}) => {
        return (
            <StackedFocusModal id="admin-api-modal">
                <StackedFocusModal.Trigger asChild>
                    <Button size="small" variant="secondary" type="button">APIs</Button>
                </StackedFocusModal.Trigger>
                <StackedFocusModal.Content className="flex flex-col">
                    <StackedFocusModal.Header>
                        <StackedFocusModal.Title>Admin API Catalog ({catalogSource})</StackedFocusModal.Title>
                    </StackedFocusModal.Header>
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
                        <div>
                            <div className="mb-2 flex items-center gap-2">
                                <div className="w-64">
                                    <Input placeholder="Search endpoints" value={apiSearch} onChange={(e) => setApiSearch(e.target.value)} />
                                </div>
                            </div>
                            <div className="mb-2">
                                <Select value={selectedEndpointId} onValueChange={setSelectedEndpointId}>
                                    <Select.Trigger>
                                        <Select.Value placeholder="Select an endpoint…" />
                                    </Select.Trigger>
                                    <Select.Content>
                                        {catalog.map((ep) => (
                                            <Select.Item key={ep.id} value={ep.id}>
                                                {ep.method} {ep.path} · {ep.summary}
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select>
                            </div>
                            {selected && (
                                <div className="text-xs text-ui-fg-subtle space-y-1">
                                    <div><b>Method:</b> {selected.method}</div>
                                    <div><b>Path:</b> {selected.path}</div>
                                    <div><b>Tags:</b> {(selected.tags || []).join(", ")}</div>
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <div>
                                <Text className="text-ui-fg-subtle text-small">Path Params</Text>
                                <Textarea rows={4} value={pathParamsJson} onChange={(e) => setPathParamsJson(e.target.value)} />
                            </div>
                            <div>
                                <Text className="text-ui-fg-subtle text-small">Query</Text>
                                <Textarea rows={4} value={queryJson} onChange={(e) => setQueryJson(e.target.value)} />
                            </div>
                            <div>
                                <Text className="text-ui-fg-subtle text-small">Body</Text>
                                <Textarea rows={6} value={bodyJson} onChange={(e) => setBodyJson(e.target.value)} />
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
                                    <input type="checkbox" checked={showJson} onChange={(e) => setShowJson(e.target.checked)} />
                                    See JSON
                                </label>
                                <Button
                                    size="small"
                                    type="button"
                                    disabled={!selected || isRunning}
                                    isLoading={isRunning}
                                    onClick={onRun}
                                >
                                    Run API
                                </Button>
                            </div>
                        </div>
                    </div>
                    <StackedFocusModal.Footer>
                        <div className="flex w-full items-center justify-end gap-x-2">
                            <StackedFocusModal.Close asChild>
                                <Button variant="secondary">Close</Button>
                            </StackedFocusModal.Close>
                        </div>
                    </StackedFocusModal.Footer>
                </StackedFocusModal.Content>
            </StackedFocusModal>
        )
    }
