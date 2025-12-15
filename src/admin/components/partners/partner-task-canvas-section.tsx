import { useEffect, useMemo, useRef, useState } from "react";
import { AdminPartner } from "../../hooks/api/partners-admin";
import { Button, Text, Badge, Textarea, toast } from "@medusajs/ui";
import { CheckCircleSolid, XCircleSolid, Clock } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { sdk } from "../../lib/config";

// React Flow imports
import { 
  ReactFlowProvider,
  ReactFlow, 
  Background, 
  Node, 
  Edge, 
  MarkerType,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Task interface
interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  start_date?: Date;
  end_date?: Date;
  parent_task_id?: string;
  subtasks?: Task[];
  metadata?: {
    comments?: TaskComment[];
    [key: string]: any;
  };
  created_at?: Date;
  updated_at?: Date;
}

interface TaskComment {
  id: string;
  comment: string;
  author_type: "partner" | "admin";
  author_name: string;
  created_at: string;
}

// Custom node data interface
interface TaskNodeData {
  label: string;
  status: string;
  priority?: string;
  task: Task;
  isParentTask?: boolean;
  onNodeClick: (task: Task) => void;
}

interface PartnerTaskCanvasSectionProps {
  partner: AdminPartner & { tasks?: Task[] };
}

export function PartnerTaskCanvasSection({ partner }: PartnerTaskCanvasSectionProps) {
  const navigate = useNavigate();
  const tasks = partner.tasks || [];
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const [newComment, setNewComment] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");

    const onChange = () => {
      setIsSmallScreen(mediaQuery.matches);
    };

    onChange();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    if (isSmallScreen && detailsRef.current) {
      detailsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedTask, isSmallScreen]);

  // Filter tasks by status
  const filteredTasks = useMemo(() => {
    if (filterStatus === "all") return tasks;
    return tasks.filter(task => task.status === filterStatus);
  }, [tasks, filterStatus]);

  // Function to get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "#fa5252";
      case "in_progress":
        return "#4c6ef5";
      case "completed":
        return "#40c057";
      case "cancelled":
      case "blocked":
        return "#9ca3af";
      default:
        return "#9ca3af";
    }
  };

  // Custom node component for tasks
  const CustomTaskNode = ({ data }: { data: TaskNodeData }) => {
    return (
      <div
        className="relative inline-flex items-center rounded-full border bg-black text-white shadow-sm cursor-pointer hover:shadow-md transition-shadow"
        style={{
          borderColor: '#2d2d2d',
          padding: '4px 10px',
          maxWidth: 280,
        }}
        onClick={() => data.onNodeClick(data.task)}
      >
        <span
          className="inline-block h-3 w-3 rounded-[3px] mr-2"
          style={{ backgroundColor: getStatusColor(data.status) }}
          aria-hidden
        />
        <span className="truncate text-xs font-medium" title={data.label} style={{ maxWidth: 240 }}>
          {data.label}
        </span>
        <Handle type="target" position={Position.Left} className="!bg-gray-400" style={{ opacity: 0.7 }} />
        <Handle type="source" position={Position.Right} className="!bg-gray-400" style={{ opacity: 0.7 }} />
      </div>
    );
  };

  const nodeTypes = useMemo(() => ({
    taskNode: CustomTaskNode,
  }), []);

  // Convert tasks to React Flow nodes and edges
  const { nodes, edges } = useMemo(() => {
    if (!filteredTasks || filteredTasks.length === 0) {
      return { nodes: [], edges: [] };
    }

    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];
    const HORIZONTAL_SPACING = 350;
    const VERTICAL_SPACING = 260;

    // Flatten tasks including subtasks
    const flattenTasks = (tasks: Task[]): Task[] => {
      let result: Task[] = [];
      tasks.forEach(task => {
        result.push(task);
        if (task.subtasks && task.subtasks.length > 0) {
          result = result.concat(flattenTasks(task.subtasks));
        }
      });
      return result;
    };

    const allTasks = flattenTasks(filteredTasks);
    const topLevelTasks = filteredTasks.filter(task => !task.parent_task_id);

    // Position tasks
    const taskMap = new Map<string, { task: Task, x: number, y: number }>();

    const positionTaskHierarchy = (
      task: Task,
      level: number,
      position: number,
      parentX?: number,
      parentY?: number,
      siblingCount?: number
    ) => {
      let x: number;
      let y: number;

      if (level === 0) {
        x = 100 + position * HORIZONTAL_SPACING;
        y = 100;
      } else {
        const count = Math.max(1, siblingCount ?? 1);
        const offset = (position - (count - 1) / 2) * (HORIZONTAL_SPACING * 0.85);
        x = (parentX || 0) + offset;
        y = (parentY || 0) + VERTICAL_SPACING;
      }

      taskMap.set(task.id, { task, x, y });

      if (task.subtasks && task.subtasks.length > 0) {
        const count = task.subtasks.length;
        task.subtasks.forEach((subtask, idx) => {
          positionTaskHierarchy(subtask, level + 1, idx, x, y, count);
        });
      }

      return { x, y };
    };

    topLevelTasks.forEach((task, index) => {
      positionTaskHierarchy(task, 0, index, undefined, undefined, topLevelTasks.length);
    });

    // Create nodes
    allTasks.forEach((task: Task) => {
      const position = taskMap.get(task.id);
      if (!position) return;

      const { x, y } = position;
      const isParentTask = task.subtasks && task.subtasks.length > 0;

      const node: Node = {
        id: task.id,
        type: 'taskNode',
        position: { x, y },
        data: {
          label: task.title || `Task ${task.id}`,
          status: task.status,
          priority: task.priority,
          task: task,
          isParentTask: isParentTask,
          onNodeClick: setSelectedTask,
        },
      };

      flowNodes.push(node);
    });

    // Create edges for parent-child relationships
    allTasks.forEach((task: Task) => {
      if (task.subtasks && task.subtasks.length > 0) {
        task.subtasks.forEach((subtask: Task, index: number) => {
          const edgeId = `${task.id}-${subtask.id}-subtask-${index}`;
          flowEdges.push({
            id: edgeId,
            source: task.id,
            target: subtask.id,
            label: 'Subtask',
            labelStyle: { fill: '#1864ab', fontWeight: 600, fontSize: 12 },
            labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
            labelBgPadding: [6, 3] as [number, number],
            labelShowBg: true,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#1864ab', strokeWidth: 3 },
            markerEnd: MarkerType.ArrowClosed,
          });
        });
      }
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [filteredTasks]);

  const handleAddComment = async () => {
    if (!newComment.trim() || !selectedTask) return;
    
    try {
      // Call the admin API to add comment
      const response = await sdk.client.fetch(`/admin/tasks/${selectedTask.id}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          comment: newComment.trim()
        })
      }) as Response;

      if (!response.ok) {
        throw new Error("Failed to add comment");
      }

      const data = await response.json() as { comment: TaskComment };
      
      // Update the selected task with the new comment
      const updatedTask = {
        ...selectedTask,
        metadata: {
          ...selectedTask.metadata,
          comments: [...(selectedTask.metadata?.comments || []), data.comment]
        }
      };
      
      setSelectedTask(updatedTask);
      setNewComment("");
      toast.success("Comment added successfully");
      
      // Optionally refresh the page to get updated data
      window.location.reload();
      
    } catch (error) {
      console.error("Error adding comment:", error);
      toast.error("Failed to add comment");
    }
  };

  const renderFilterBar = () => {
    return (
      <div className="border-b p-4">
        <div className="flex flex-col gap-y-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-x-2 overflow-x-auto whitespace-nowrap pb-1">
            <Button
              variant={filterStatus === "all" ? "primary" : "secondary"}
              size="small"
              onClick={() => setFilterStatus("all")}
              className="flex-shrink-0"
            >
              All ({tasks.length})
            </Button>
            <Button
              variant={filterStatus === "pending" ? "primary" : "secondary"}
              size="small"
              onClick={() => setFilterStatus("pending")}
              className="flex-shrink-0"
            >
              Pending ({tasks.filter(t => t.status === "pending").length})
            </Button>
            <Button
              variant={filterStatus === "in_progress" ? "primary" : "secondary"}
              size="small"
              onClick={() => setFilterStatus("in_progress")}
              className="flex-shrink-0"
            >
              In Progress ({tasks.filter(t => t.status === "in_progress").length})
            </Button>
            <Button
              variant={filterStatus === "completed" ? "primary" : "secondary"}
              size="small"
              onClick={() => setFilterStatus("completed")}
              className="flex-shrink-0"
            >
              Completed ({tasks.filter(t => t.status === "completed").length})
            </Button>
          </div>

          <Button
            variant="secondary"
            size="small"
            onClick={() => navigate(`/partners/${partner.id}/tasks/new`)}
            className="w-full flex-shrink-0 sm:w-auto"
          >
            Create New Task
          </Button>
        </div>
      </div>
    );
  };

  if (isSmallScreen) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto">
        {renderFilterBar()}

        {!selectedTask ? (
          <div className="flex flex-1 flex-col gap-y-3 p-4">
            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTask(task)}
                  className="w-full rounded-lg border border-ui-border-base bg-ui-bg-base p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-x-4">
                    <div className="min-w-0 flex-1">
                      <Text size="base" weight="plus" className="truncate">
                        {task.title}
                      </Text>
                      {task.description && (
                        <Text size="small" className="mt-1 line-clamp-2 text-ui-fg-subtle">
                          {task.description}
                        </Text>
                      )}
                    </div>
                    <Badge
                      size="small"
                      color={
                        task.status === "completed" ? "green" :
                        task.status === "in_progress" ? "blue" :
                        task.status === "pending" ? "orange" : "grey"
                      }
                      className="flex-shrink-0"
                    >
                      {task.status.replace("_", " ")}
                    </Badge>
                  </div>
                </button>
              ))
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No tasks found for the selected filter
              </Text>
            )}
          </div>
        ) : (
          <div ref={detailsRef} className="flex flex-1 flex-col overflow-hidden">
            <div className="border-b p-4">
              <div className="flex items-center justify-between gap-x-3">
                <Button variant="secondary" size="small" type="button" onClick={() => setSelectedTask(null)}>
                  Back
                </Button>
                <div className="min-w-0 flex-1">
                  <Text size="base" weight="plus" className="truncate">
                    {selectedTask.title}
                  </Text>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-6 border-b">
                {selectedTask.description && (
                  <Text size="small" className="text-ui-fg-subtle mb-4">
                    {selectedTask.description}
                  </Text>
                )}

                <div className="flex items-center gap-2 mb-4">
                  <Badge
                    size="small"
                    color={
                      selectedTask.status === "completed" ? "green" :
                      selectedTask.status === "in_progress" ? "blue" :
                      selectedTask.status === "pending" ? "orange" : "grey"
                    }
                  >
                    {selectedTask.status.replace("_", " ")}
                  </Badge>
                  {selectedTask.priority && (
                    <Badge
                      size="small"
                      color={
                        selectedTask.priority === "high" ? "red" :
                        selectedTask.priority === "medium" ? "orange" : "green"
                      }
                    >
                      {selectedTask.priority}
                    </Badge>
                  )}
                </div>

                {(selectedTask.start_date || selectedTask.end_date) && (
                  <div className="flex flex-col gap-2 text-xs text-ui-fg-muted">
                    {selectedTask.start_date && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>Start: {format(new Date(selectedTask.start_date), "MMM dd, yyyy")}</span>
                      </div>
                    )}
                    {selectedTask.end_date && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>End: {format(new Date(selectedTask.end_date), "MMM dd, yyyy")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
                <div className="p-6 border-b">
                  <Text size="base" weight="plus" className="mb-3">
                    Subtasks ({selectedTask.subtasks.filter(st => st.status === "completed").length}/{selectedTask.subtasks.length} completed)
                  </Text>
                  <div className="space-y-2">
                    {selectedTask.subtasks.map((subtask) => (
                      <div
                        key={subtask.id}
                        className="flex items-start gap-2 p-3 rounded-md bg-ui-bg-subtle border border-ui-border-base cursor-pointer hover:bg-ui-bg-subtle-hover"
                        onClick={() => setSelectedTask(subtask)}
                      >
                        <div className="flex-shrink-0 mt-1">
                          {subtask.status === "completed" ? (
                            <CheckCircleSolid className="w-4 h-4 text-green-600" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-ui-border-base" />
                          )}
                        </div>
                        <div className="flex-1">
                          <Text size="small" weight="plus">{subtask.title}</Text>
                          {subtask.description && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {subtask.description}
                            </Text>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-6">
                <Text size="base" weight="plus" className="mb-3">
                  Comments ({selectedTask.metadata?.comments?.length || 0})
                </Text>

                <div className="space-y-4 mb-6">
                  {selectedTask.metadata?.comments && selectedTask.metadata.comments.length > 0 ? (
                    selectedTask.metadata.comments.map((comment: TaskComment) => (
                      <div key={comment.id} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Text size="small" weight="plus">
                            {comment.author_name}
                          </Text>
                          <Badge size="xsmall" color={comment.author_type === "admin" ? "purple" : "blue"}>
                            {comment.author_type}
                          </Badge>
                          <Text size="xsmall" className="text-ui-fg-muted">
                            {format(new Date(comment.created_at), "MMM dd, yyyy 'at' h:mm a")}
                          </Text>
                        </div>
                        <Text size="small">{comment.comment}</Text>
                      </div>
                    ))
                  ) : (
                    <Text size="small" className="text-ui-fg-muted">
                      No comments yet
                    </Text>
                  )}
                </div>

                <Textarea
                  placeholder="Add a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="mb-3"
                  rows={3}
                />
                <Button size="small" onClick={handleAddComment} disabled={!newComment.trim()}>
                  Add Comment
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* Main canvas area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {renderFilterBar()}

        {/* Canvas */}
        <div className="relative min-h-[55vh] flex-1 lg:min-h-[70vh]">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              defaultEdgeOptions={{
                type: 'smoothstep',
                style: { strokeWidth: 3 },
                animated: true,
              }}
              minZoom={0.2}
              maxZoom={1.5}
              defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
              className="h-full w-full"
            >
              <Background gap={16} size={1} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>

      {/* Sidebar - Task Details and Comments */}
      {selectedTask && (
        <div
          ref={detailsRef}
          className="flex max-h-[55vh] w-full flex-col overflow-hidden border-t lg:max-h-none lg:h-full lg:w-96 lg:border-l lg:border-t-0"
        >
          {/* Task Header */}
          <div className="p-6 border-b">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <Text size="large" weight="plus" className="mb-2">
                  {selectedTask.title}
                </Text>
                <div className="flex items-center gap-2">
                  <Badge
                    size="small"
                    color={
                      selectedTask.status === "completed" ? "green" :
                      selectedTask.status === "in_progress" ? "blue" :
                      selectedTask.status === "pending" ? "orange" : "grey"
                    }
                  >
                    {selectedTask.status.replace("_", " ")}
                  </Badge>
                  {selectedTask.priority && (
                    <Badge
                      size="small"
                      color={
                        selectedTask.priority === "high" ? "red" :
                        selectedTask.priority === "medium" ? "orange" : "green"
                      }
                    >
                      {selectedTask.priority}
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="transparent"
                size="small"
                onClick={() => setSelectedTask(null)}
              >
                <XCircleSolid />
              </Button>
            </div>

            {selectedTask.description && (
              <Text size="small" className="text-ui-fg-subtle mb-4">
                {selectedTask.description}
              </Text>
            )}

            {(selectedTask.start_date || selectedTask.end_date) && (
              <div className="flex items-center gap-4 text-xs text-ui-fg-muted">
                {selectedTask.start_date && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>Start: {format(new Date(selectedTask.start_date), "MMM dd, yyyy")}</span>
                  </div>
                )}
                {selectedTask.end_date && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>End: {format(new Date(selectedTask.end_date), "MMM dd, yyyy")}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Subtasks Section */}
          {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
            <div className="p-6 border-b">
              <Text size="base" weight="plus" className="mb-3">
                Subtasks ({selectedTask.subtasks.filter(st => st.status === "completed").length}/{selectedTask.subtasks.length} completed)
              </Text>
              <div className="space-y-2">
                {selectedTask.subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="flex items-start gap-2 p-3 rounded-md bg-ui-bg-subtle border border-ui-border-base cursor-pointer hover:bg-ui-bg-subtle-hover"
                    onClick={() => setSelectedTask(subtask)}
                  >
                    <div className="flex-shrink-0 mt-1">
                      {subtask.status === "completed" ? (
                        <CheckCircleSolid className="w-4 h-4 text-green-600" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-ui-border-base" />
                      )}
                    </div>
                    <div className="flex-1">
                      <Text size="small" weight="plus">{subtask.title}</Text>
                      {subtask.description && (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {subtask.description}
                        </Text>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments Section */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-6 border-b">
              <Text size="base" weight="plus">
                Comments ({selectedTask.metadata?.comments?.length || 0})
              </Text>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedTask.metadata?.comments && selectedTask.metadata.comments.length > 0 ? (
                selectedTask.metadata.comments.map((comment: TaskComment) => (
                  <div key={comment.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Text size="small" weight="plus">
                        {comment.author_name}
                      </Text>
                      <Badge size="xsmall" color={comment.author_type === "admin" ? "purple" : "blue"}>
                        {comment.author_type}
                      </Badge>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {format(new Date(comment.created_at), "MMM dd, yyyy 'at' h:mm a")}
                      </Text>
                    </div>
                    <Text size="small">{comment.comment}</Text>
                  </div>
                ))
              ) : (
                <Text size="small" className="text-ui-fg-muted">
                  No comments yet
                </Text>
              )}
            </div>

            {/* Add Comment */}
            <div className="p-6 border-t">
              <Textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="mb-3"
                rows={3}
              />
              <Button
                size="small"
                onClick={handleAddComment}
                disabled={!newComment.trim()}
              >
                Add Comment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
