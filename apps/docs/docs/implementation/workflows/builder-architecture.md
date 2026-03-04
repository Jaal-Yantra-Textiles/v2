---
title: "Visual Workflow Builder Architecture"
sidebar_label: "Builder Architecture"
sidebar_position: 1
---

# Visual Workflow Builder Architecture

## Overview

This document outlines the architecture for building a visual workflow builder similar to Directus Flows, built on top of MedusaJS v2's workflow engine. The system allows users to create, manage, and execute workflows through a drag-and-drop visual interface.

## Inspiration: Directus Flows

Directus Flows provides:
1. **Visual Editor**: Drag-and-drop interface for building workflows
2. **Triggers**: Events that start flows (data changes, schedules, webhooks, manual)
3. **Operations**: Individual actions (CRUD, HTTP requests, scripts, conditions, notifications)
4. **Data Chain**: Shared context passed between operations with variable interpolation (`{{ $trigger.payload }}`)
5. **Logging**: Execution logs for debugging

## Architecture Components

### 1. Data Models (Database Schema)

```
┌─────────────────────────────────────────────────────────────────┐
│                         visual_flow                              │
├─────────────────────────────────────────────────────────────────┤
│ id              │ Primary Key                                    │
│ name            │ Display name                                   │
│ description     │ Optional description                           │
│ status          │ "active" | "inactive" | "draft"                │
│ icon            │ Optional icon identifier                       │
│ color           │ Optional color for UI                          │
│ trigger_type    │ "event" | "schedule" | "webhook" | "manual"    │
│ trigger_config  │ JSON - trigger-specific configuration          │
│ canvas_state    │ JSON - React Flow nodes/edges positions        │
│ metadata        │ JSON - additional metadata                     │
│ created_at      │ Timestamp                                      │
│ updated_at      │ Timestamp                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      visual_flow_operation                       │
├─────────────────────────────────────────────────────────────────┤
│ id              │ Primary Key                                    │
│ flow_id         │ Foreign Key → visual_flow                      │
│ operation_key   │ Unique key within flow (for data chain refs)   │
│ operation_type  │ "condition" | "create_data" | "update_data" |  │
│                 │ "delete_data" | "read_data" | "http_request" | │
│                 │ "run_script" | "send_email" | "notification" | │
│                 │ "transform" | "trigger_workflow" | "sleep"     │
│ name            │ Display name                                   │
│ options         │ JSON - operation-specific configuration        │
│ position_x      │ Canvas X position                              │
│ position_y      │ Canvas Y position                              │
│ sort_order      │ Execution order                                │
│ created_at      │ Timestamp                                      │
│ updated_at      │ Timestamp                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      visual_flow_connection                      │
├─────────────────────────────────────────────────────────────────┤
│ id              │ Primary Key                                    │
│ flow_id         │ Foreign Key → visual_flow                      │
│ source_id       │ Source operation ID (or "trigger")             │
│ target_id       │ Target operation ID                            │
│ connection_type │ "success" | "failure" | "default"              │
│ condition       │ JSON - optional condition for this path        │
│ created_at      │ Timestamp                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      visual_flow_execution                       │
├─────────────────────────────────────────────────────────────────┤
│ id              │ Primary Key                                    │
│ flow_id         │ Foreign Key → visual_flow                      │
│ status          │ "pending" | "running" | "completed" | "failed" │
│ trigger_data    │ JSON - data that triggered the flow            │
│ data_chain      │ JSON - accumulated data from operations        │
│ started_at      │ Timestamp                                      │
│ completed_at    │ Timestamp                                      │
│ error           │ Error message if failed                        │
│ metadata        │ JSON - execution metadata                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   visual_flow_execution_log                      │
├─────────────────────────────────────────────────────────────────┤
│ id              │ Primary Key                                    │
│ execution_id    │ Foreign Key → visual_flow_execution            │
│ operation_id    │ Foreign Key → visual_flow_operation (nullable) │
│ operation_key   │ Operation key or "trigger"                     │
│ status          │ "success" | "failure" | "skipped"              │
│ input_data      │ JSON - data passed to operation                │
│ output_data     │ JSON - data returned by operation              │
│ error           │ Error message if failed                        │
│ duration_ms     │ Execution duration in milliseconds             │
│ executed_at     │ Timestamp                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Operation Types

Each operation type maps to specific functionality:

| Type | Category | Description |
|------|----------|-------------|
| `condition` | Logic | Branch on filter rules |
| `execute_code` | Logic | Sandboxed JS (lodash, dayjs, uuid, crypto) |
| `transform` | Logic | Map/reshape data |
| `create_data` | Data | Call module `.create*()` |
| `read_data` | Data | Query via `query.graph()` |
| `update_data` | Data | Call module `.update*()` |
| `delete_data` | Data | Call module `.delete*()` |
| `bulk_update_data` | Data | Batch update records |
| `http_request` | Integration | External HTTP calls |
| `trigger_workflow` | Integration | Run any registered Medusa workflow |
| `trigger_flow` | Integration | Invoke another visual flow |
| `ai_extract` | Integration | Ask LLM to extract structured JSON |
| `send_email` | Communication | Send email via Resend |
| `notification` | Communication | Admin notification |
| `sleep` | Utility | Delay execution |
| `log` | Utility | Log to execution trace |
| `aggregate_product_analytics` | Analytics | Analytics aggregation |

### 3. Trigger Types

| Trigger Type | Description | Implementation |
|-------------|-------------|----------------|
| `event` | Triggered by data changes | Workflow hooks on modules |
| `schedule` | Triggered on schedule | Cron job integration |
| `webhook` | Triggered by HTTP request | API endpoint |
| `manual` | Triggered manually | Admin UI button |
| `another_flow` | Triggered by another flow | Internal trigger |

### 4. Data Chain System

The data chain is a JSON object that accumulates data as the flow executes:

```typescript
interface DataChain {
  $trigger: {
    payload: any;        // Data that triggered the flow
    event?: string;      // Event name if event trigger
    timestamp: string;   // When triggered
  };
  $accountability: {
    user_id?: string;    // User who triggered (if applicable)
    role?: string;       // User's role
    ip?: string;         // Request IP
  };
  $env: Record<string, string>;  // Allowed environment variables
  $last: any;            // Result of last operation
  [operationKey: string]: any;   // Results keyed by operation key
}
```

Variable interpolation syntax: `{{ $trigger.payload.email }}` or `{{ operation_key.result.id }}`

### 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Admin UI (React)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  Flow List      │  │  Visual Editor  │  │  Execution Logs         │  │
│  │  - CRUD flows   │  │  - React Flow   │  │  - View executions      │  │
│  │  - Status mgmt  │  │  - Drag & drop  │  │  - Debug data chain     │  │
│  │                 │  │  - Node config  │  │  - Error tracking       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Layer (MedusaJS)                             │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  Flow CRUD API  │  │  Execution API  │  │  Webhook Trigger API    │  │
│  │  /admin/flows   │  │  /admin/flows/  │  │  /webhooks/flows/:id    │  │
│  │                 │  │  :id/execute    │  │                         │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Visual Flow Module                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  Flow Service   │  │  Execution      │  │  Operation              │  │
│  │  - CRUD ops     │  │  Engine         │  │  Registry               │  │
│  │  - Validation   │  │  - Run flows    │  │  - Operation handlers   │  │
│  │                 │  │  - Data chain   │  │  - Custom operations    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    MedusaJS Workflow Engine                              │
├─────────────────────────────────────────────────────────────────────────┤
│  - createWorkflow / createStep                                          │
│  - StepResponse / WorkflowResponse                                      │
│  - transform / when                                                     │
│  - Existing workflows (email, notifications, etc.)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6. Execution Engine

The execution engine converts visual flows to runtime execution:

```typescript
class FlowExecutionEngine {
  async execute(flowId: string, triggerData: any): Promise<FlowExecution> {
    // 1. Load flow definition
    const flow = await this.flowService.retrieve(flowId);
    
    // 2. Initialize data chain
    const dataChain: DataChain = {
      $trigger: { payload: triggerData, timestamp: new Date().toISOString() },
      $accountability: this.getAccountability(),
      $env: this.getAllowedEnvVars(),
      $last: null,
    };
    
    // 3. Create execution record
    const execution = await this.createExecution(flowId, dataChain);
    
    // 4. Build execution graph from operations and connections
    const graph = this.buildExecutionGraph(flow.operations, flow.connections);
    
    // 5. Execute operations in order
    await this.executeGraph(graph, dataChain, execution);
    
    // 6. Return completed execution
    return execution;
  }
  
  private async executeOperation(
    operation: VisualFlowOperation,
    dataChain: DataChain,
    execution: FlowExecution
  ): Promise<any> {
    // Get operation handler from registry
    const handler = this.operationRegistry.get(operation.operation_type);
    
    // Interpolate variables in options
    const resolvedOptions = this.interpolateVariables(operation.options, dataChain);
    
    // Execute and log
    const startTime = Date.now();
    try {
      const result = await handler.execute(resolvedOptions, dataChain, this.container);
      
      // Update data chain
      dataChain[operation.operation_key] = result;
      dataChain.$last = result;
      
      // Log success
      await this.logOperation(execution.id, operation, 'success', resolvedOptions, result, Date.now() - startTime);
      
      return result;
    } catch (error) {
      await this.logOperation(execution.id, operation, 'failure', resolvedOptions, null, Date.now() - startTime, error);
      throw error;
    }
  }
}
```

### 7. Operation Registry

Extensible registry for operation handlers:

```typescript
interface OperationHandler {
  type: string;
  name: string;
  description: string;
  icon: string;
  optionsSchema: ZodSchema;  // For validation and UI generation
  execute: (options: any, dataChain: DataChain, container: MedusaContainer) => Promise<any>;
}

class OperationRegistry {
  private handlers: Map<string, OperationHandler> = new Map();
  
  register(handler: OperationHandler) {
    this.handlers.set(handler.type, handler);
  }
  
  get(type: string): OperationHandler {
    return this.handlers.get(type);
  }
  
  getAll(): OperationHandler[] {
    return Array.from(this.handlers.values());
  }
}

// Example: Create Data Operation
const createDataHandler: OperationHandler = {
  type: 'create_data',
  name: 'Create Data',
  description: 'Create a new record in a module',
  icon: 'plus-circle',
  optionsSchema: z.object({
    module: z.string(),
    collection: z.string(),
    data: z.record(z.any()),
  }),
  execute: async (options, dataChain, container) => {
    const service = container.resolve(options.module);
    const method = `create${capitalize(options.collection)}`;
    return await service[method](options.data);
  },
};
```

### 8. React Flow Integration

The visual editor uses React Flow with custom nodes:

```typescript
// Custom node types
const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  operation: OperationNode,
};

// Node component example
const OperationNode = ({ data, selected }) => {
  const operation = operationRegistry.get(data.operationType);
  
  return (
    <div className={cn("operation-node", selected && "selected")}>
      <Handle type="target" position={Position.Top} />
      
      <div className="node-header">
        <Icon name={operation.icon} />
        <span>{data.name || operation.name}</span>
      </div>
      
      <div className="node-body">
        {/* Operation-specific preview */}
      </div>
      
      <Handle type="source" position={Position.Bottom} id="success" />
      {data.operationType === 'condition' && (
        <Handle type="source" position={Position.Right} id="failure" />
      )}
    </div>
  );
};
```

### 9. Directory Structure

```
src/
├── modules/
│   └── visual_flows/
│       ├── index.ts
│       ├── models/
│       │   ├── visual-flow.ts
│       │   ├── visual-flow-operation.ts
│       │   ├── visual-flow-connection.ts
│       │   ├── visual-flow-execution.ts
│       │   └── visual-flow-execution-log.ts
│       ├── service.ts
│       ├── execution-engine.ts
│       ├── operation-registry.ts
│       └── operations/
│           ├── index.ts
│           ├── condition.ts
│           ├── execute-code.ts
│           ├── transform.ts
│           ├── create-data.ts
│           ├── read-data.ts
│           ├── update-data.ts
│           ├── delete-data.ts
│           ├── bulk-update-data.ts
│           ├── http-request.ts
│           ├── trigger-workflow.ts
│           ├── trigger-flow.ts
│           ├── ai-extract.ts
│           ├── send-email.ts
│           ├── notification.ts
│           ├── sleep.ts
│           ├── log.ts
│           └── aggregate-product-analytics.ts
├── api/
│   ├── admin/
│   │   └── visual-flows/
│   │       ├── route.ts              # List/Create flows
│   │       ├── [id]/
│   │       │   ├── route.ts          # Get/Update/Delete flow
│   │       │   ├── execute/
│   │       │   │   └── route.ts      # Manual execution
│   │       │   └── executions/
│   │       │       └── route.ts      # List executions
│   │       └── operations/
│   │           └── route.ts          # List available operations
│   └── webhooks/
│       └── flows/
│           └── [id]/
│               └── route.ts          # Webhook trigger
├── admin/
│   ├── routes/
│   │   └── visual-flows/
│   │       ├── page.tsx              # Flow list
│   │       ├── [id]/
│   │       │   ├── page.tsx          # Flow detail/editor
│   │       │   └── executions/
│   │       │       └── page.tsx      # Execution logs
│   │       └── create/
│   │           └── page.tsx          # Create new flow
│   └── components/
│       └── visual-flows/
│           ├── flow-editor.tsx       # Main React Flow editor
│           ├── nodes/
│           │   ├── trigger-node.tsx
│           │   ├── operation-node.tsx
│           │   └── condition-node.tsx
│           ├── panels/
│           │   ├── operations-panel.tsx
│           │   ├── properties-panel.tsx
│           │   └── execution-panel.tsx
│           └── modals/
│               ├── operation-config-modal.tsx
│               └── trigger-config-modal.tsx
└── jobs/
    └── scheduled-flows.ts            # Cron job for scheduled flows
```

## Implementation Phases

### Phase 1: Foundation ✅
- [x] Create visual-flows module with data models
- [x] Implement basic CRUD service
- [x] Create operation registry with core operations
- [x] Build basic API routes

### Phase 2: Execution Engine ✅
- [x] Implement execution engine
- [x] Add data chain and variable interpolation
- [x] Create execution logging
- [x] Add error handling and rollback

### Phase 3: Visual Editor ✅
- [x] Set up React Flow in admin
- [x] Create custom node components
- [x] Build operations sidebar
- [x] Implement properties panel
- [x] Add canvas state persistence

### Phase 4: Triggers & Integration ✅
- [x] Implement webhook triggers
- [x] Add event-based triggers (workflow hooks)
- [x] Create scheduled flow job
- [x] Integrate with existing MedusaJS workflows

### Phase 5: Polish & Testing ✅
- [x] Add execution logs viewer
- [x] Implement flow testing/debugging
- [x] Add flow import/export
- [x] Write integration tests
- [x] Documentation

## Key Dependencies

```json
{
  "@xyflow/react": "^12.0.0",
  "elkjs": "^0.9.0",
  "zustand": "^4.5.0",
  "zod": "^3.22.0"
}
```

## Security Considerations

1. **Script Execution**: Run custom scripts in isolated sandbox (vm2 or similar)
2. **Environment Variables**: Only expose whitelisted env vars via `$env`
3. **Module Access**: Validate module/collection access based on user permissions
4. **Rate Limiting**: Limit flow executions per minute
5. **Audit Logging**: Log all flow modifications and executions

## Future Enhancements

1. **Flow Templates**: Pre-built flow templates for common use cases
2. **Flow Versioning**: Version control for flow definitions
3. **Parallel Execution**: Support for parallel operation branches
4. **Retry Logic**: Configurable retry policies for failed operations
5. **Flow Marketplace**: Share and import community flows
6. **AI-Assisted Building**: Use AI to suggest operations based on description
