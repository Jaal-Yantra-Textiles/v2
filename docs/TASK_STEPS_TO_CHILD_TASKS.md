# Converting Task Steps to Child Tasks - Implementation Guide

## ✅ Completed

### 1. Admin Task Creation Component
- ✅ Updated `create-partner-task-with-tabs.tsx` to create child tasks instead of metadata steps
- ✅ Changed payload to include `child_tasks` array
- ✅ Added `dependency_type: "subtask"` to establish parent-child relationship
- ✅ Updated UI note to reflect that steps are now actual tasks

## 🔄 Next Steps Required

### 2. Partner API Endpoints

#### Create GET endpoint for subtasks
**File**: `/src/api/partners/assigned-tasks/[taskId]/subtasks/route.ts`
```typescript
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getPartnerFromActorId } from "../../../helpers";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { taskId } = req.params;
  const actorId = req.auth_context?.actor_id;
  
  if (!actorId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const partner = await getPartnerFromActorId(actorId, req.scope);
  if (!partner) {
    return res.status(401).json({ error: "Partner not found" });
  }

  const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
  
  // Verify parent task is assigned to this partner
  const parentTask = await taskService.retrieveTask(taskId, {
    relations: ["subtasks"],
  });

  // Check if task is assigned to partner (via partner-task link)
  // ... add verification logic

  // Return subtasks sorted by order
  const subtasks = parentTask.subtasks || [];
  const sortedSubtasks = subtasks.sort((a, b) => {
    const orderA = a.metadata?.order || 0;
    const orderB = b.metadata?.order || 0;
    return orderA - orderB;
  });

  res.status(200).json({
    subtasks: sortedSubtasks,
    count: sortedSubtasks.length,
  });
}
```

#### Create POST endpoint for completing subtasks
**File**: `/src/api/partners/assigned-tasks/[taskId]/subtasks/[subtaskId]/complete/route.ts`
```typescript
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { getPartnerFromActorId } from "../../../../helpers";
import { TASKS_MODULE } from "../../../../../../modules/tasks";
import TaskService from "../../../../../../modules/tasks/service";

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { taskId, subtaskId } = req.params;
  const actorId = req.auth_context?.actor_id;
  
  if (!actorId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const partner = await getPartnerFromActorId(actorId, req.scope);
  if (!partner) {
    return res.status(401).json({ error: "Partner not found" });
  }

  const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
  
  // Verify subtask belongs to parent task
  const subtask = await taskService.retrieveTask(subtaskId, {
    relations: ["parent_task"],
  });

  if (subtask.parent_task?.id !== taskId) {
    return res.status(400).json({ error: "Subtask does not belong to this task" });
  }

  // Update subtask status
  const updatedSubtask = await taskService.updateTasks({
    id: subtaskId,
    status: "completed",
    completed_at: new Date(),
  });

  // Check if all subtasks are completed, then complete parent
  const parentTask = await taskService.retrieveTask(taskId, {
    relations: ["subtasks"],
  });

  const allSubtasksCompleted = parentTask.subtasks.every(
    (st) => st.status === "completed"
  );

  if (allSubtasksCompleted) {
    await taskService.updateTasks({
      id: taskId,
      status: "completed",
      completed_at: new Date(),
    });
  }

  res.status(200).json({
    subtask: updatedSubtask,
    parent_completed: allSubtasksCompleted,
  });
}
```

### 3. Update Middlewares

**File**: `/src/api/middlewares.ts`

Add routes for subtasks:
```typescript
{
  matcher: "/partners/assigned-tasks/:taskId/subtasks",
  method: "GET",
  middlewares: [
    authenticate("partner", ["session", "bearer"]),
  ],
},
{
  matcher: "/partners/assigned-tasks/:taskId/subtasks/:subtaskId/complete",
  method: "POST",
  middlewares: [
    authenticate("partner", ["session", "bearer"]),
  ],
},
```

### 4. Partner Dashboard Actions

**File**: `/src/partner/app/dashboard/actions.ts`

Add server actions:
```typescript
export async function getTaskSubtasks(taskId: string) {
  const token = await getAuthCookie();
  if (!token) redirect("/login");

  const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000";

  try {
    const response = await fetch(
      `${MEDUSA_BACKEND_URL}/partners/assigned-tasks/${taskId}/subtasks`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    await enforceAuthOrRedirect(response);
    
    if (!response.ok) {
      console.error("Failed to fetch subtasks");
      return { subtasks: [], count: 0 };
    }

    return await response.json();
  } catch (e) {
    throw e;
  }
}

export async function completeSubtask(taskId: string, subtaskId: string) {
  const token = await getAuthCookie();
  if (!token) redirect("/login");

  const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000";

  const response = await fetch(
    `${MEDUSA_BACKEND_URL}/partners/assigned-tasks/${taskId}/subtasks/${subtaskId}/complete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  await enforceAuthOrRedirect(response);

  if (!response.ok) {
    throw new Error("Failed to complete subtask");
  }

  return await response.json();
}
```

### 5. Update Partner Task Detail Page

**File**: `/src/partner/app/dashboard/tasks/[taskId]/task-detail-content.tsx`

Update to fetch and display subtasks:
```typescript
// Add to component state
const [subtasks, setSubtasks] = useState<Subtask[]>([]);
const [isLoadingSubtasks, setIsLoadingSubtasks] = useState(true);

// Fetch subtasks on mount
useEffect(() => {
  async function fetchSubtasks() {
    try {
      const result = await getTaskSubtasks(task.id);
      setSubtasks(result.subtasks || []);
    } catch (error) {
      console.error("Failed to fetch subtasks:", error);
    } finally {
      setIsLoadingSubtasks(false);
    }
  }
  fetchSubtasks();
}, [task.id]);

// Add handler for completing subtask
const handleCompleteSubtask = async (subtaskId: string) => {
  try {
    await completeSubtask(task.id, subtaskId);
    router.refresh();
    // Refetch subtasks
    const result = await getTaskSubtasks(task.id);
    setSubtasks(result.subtasks || []);
  } catch (error) {
    console.error("Failed to complete subtask:", error);
  }
};

// Update the steps section to show actual subtasks instead of metadata
```

## 📊 Benefits of This Approach

1. **Individual Tracking**: Each step is a real task with its own status
2. **Better Analytics**: Can track completion time for each step
3. **Flexible Updates**: Partners can update steps independently
4. **Automatic Parent Completion**: Parent task completes when all subtasks are done
5. **Scalable**: Can add more features to subtasks (comments, attachments, etc.)

## 🔍 Testing Checklist

- [ ] Create a task with multiple steps from admin
- [ ] Verify child tasks are created in database
- [ ] Partner can view all subtasks in task detail page
- [ ] Partner can complete individual subtasks
- [ ] Parent task auto-completes when all subtasks are done
- [ ] Workflow preview shows correct step order
- [ ] Comments work on both parent and child tasks
