import { RouteFocusModal } from "../modal/route-focus-modal";
import { useMemo } from "react";
import { AdminDesign } from "../../hooks/api/designs";
import { Container, Heading, Tooltip } from "@medusajs/ui";
import { ActionMenu } from "../common/action-menu";
import { Eye, InformationCircle } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminDesignTask } from "../../hooks/api/design-tasks";

// React Flow imports
import { 
  ReactFlowProvider,
  ReactFlow, 
  Background, 
  Controls, 
  Node, 
  Edge, 
  MarkerType,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Extend the AdminDesignTask interface with any additional properties needed for visualization
interface Task extends AdminDesignTask {
  // Additional properties for visualization if needed
  subtasks?: Task[];
  [key: string]: any;
}

// Custom node data interface
interface TaskNodeData {
  label: string;
  status: string;
  priority?: string;
  task: Task;
  isParentTask?: boolean;
}

interface DesignTaskCanvasSectionProps {
  design: AdminDesign;
}

export function DesignTaskCanvasSection({ design }: DesignTaskCanvasSectionProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const tasks = design.tasks || [];
  
  console.log('Design tasks:', tasks)
  
  // Debug: Check if tasks have subtasks
  tasks.forEach(task => {
    console.log(`Task ${task.id} has subtasks:`, task.subtasks ? task.subtasks.length : 0)
  })

  // Function to get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "#ffc9c9"; // Light red
      case "in_progress":
        return "#a5d8ff"; // Light blue
      case "completed":
        return "#c0eb75"; // Light green
      case "cancelled":
      case "blocked":
        return "#e9ecef"; // Light gray
      default:
        return "#e9ecef"; // Light gray
    }
  };

  // Function to get dependency type color and style
  const getDependencyStyle = (dependencyType?: string) => {
    switch (dependencyType) {
      case "blocking":
        return {
          color: "#fa5252", // Red for blocking dependencies
          strokeWidth: 3,
          type: "straight",
          markerEnd: MarkerType.ArrowClosed,
          label: "Blocking",
          labelStyle: { fill: "#fa5252", fontWeight: 700 }
        };
      case "non_blocking":
        return {
          color: "#4dabf7", // Blue for non-blocking dependencies
          strokeWidth: 2,
          type: "straight",
          markerEnd: MarkerType.ArrowClosed,
          label: "Non-blocking",
          labelStyle: { fill: "#4dabf7" }
        };
      case "related":
        return {
          color: "#8ce99a", // Green for related tasks
          strokeWidth: 2,
          type: "straight",
          style: { strokeDasharray: '5,5' },
          markerEnd: MarkerType.ArrowClosed,
          label: "Related",
          labelStyle: { fill: "#8ce99a" }
        };
      case "subtask":
      default:
        return {
          color: "#1864ab", // Default blue for subtasks
          strokeWidth: 2,
          type: "straight",
          markerEnd: MarkerType.ArrowClosed,
          label: "Subtask",
          labelStyle: { fill: "#1864ab" }
        };
    }
  };

  // We're not using priority colors for the simplified design
  // but keeping the function commented in case we need it later
  /*
  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case "high":
        return "#e03131"; // Red
      case "medium":
        return "#1971c2"; // Blue
      case "low":
        return "#2f9e44"; // Green
      default:
        return "#495057"; // Gray
    }
  };
  */

  // Custom node component for tasks
  const CustomTaskNode = ({ data }: { data: TaskNodeData }) => {
    // Format status text for display
    const formatStatus = (status: string): string => {
      return status.replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };
    
    // Get status emoji
    const getStatusEmoji = (status: string): string => {
      switch (status) {
        case "pending":
          return "⏳";
        case "in_progress":
          return "🔄";
        case "completed":
          return "✅";
        case "cancelled":
          return "❌";
        case "blocked":
          return "🚫";
        default:
          return "❓";
      }
    };
    
    // Generate task details for tooltip
    const getTaskDetails = () => {
      const details = [
        `Status: ${formatStatus(data.status)}`,
        data.task.priority ? `Priority: ${data.task.priority}` : null,
        data.task.due_date ? `Due: ${new Date(data.task.due_date).toLocaleDateString()}` : null,
        data.task.assigned_to ? `Assigned to: ${data.task.assigned_to}` : null,
        data.isParentTask ? 'Has subtasks' : null,
      ].filter(Boolean);
      
      return details.join('\n');
    };
    
    return (
      <div className="px-3 py-2 shadow-md rounded-md bg-white border-2 relative" 
        style={{
          borderColor: data.isParentTask ? '#3b82f6' : '#e5e7eb',
          width: '130px', // Reduced width
        }}
      >
        {/* Info icon with tooltip */}
        <div className="absolute -top-2 -right-2 z-10">
          <Tooltip content={getTaskDetails()}>
            <div className="bg-white rounded-full p-1 shadow-sm border border-gray-200 cursor-help">
              <InformationCircle className="text-gray-500 h-3 w-3" />
            </div>
          </Tooltip>
        </div>
        
        <div className="flex">
          {/* Status emoji circle */}
          <div className="rounded-full w-8 h-8 flex justify-center items-center" 
            style={{ backgroundColor: `${getStatusColor(data.status)}30` }}
          >
            {getStatusEmoji(data.status)}
          </div>
          
          {/* Task title */}
          <div className="ml-2 overflow-hidden">
            <div className="font-bold text-xs flex items-center">
              {data.isParentTask && (
                <span style={{ color: '#3b82f6', marginRight: '2px' }} title="Has subtasks">•</span>
              )}
              <span className="truncate" style={{ maxWidth: '80px' }}>
                {data.label}
              </span>
            </div>
            <div className="text-xs text-gray-500 truncate" style={{ maxWidth: '80px' }}>
              {formatStatus(data.status)}
            </div>
          </div>
        </div>
        
        {/* Connection handles */}
        <Handle
          type="target"
          position={Position.Top}
          className="w-10 !bg-teal-500"
          style={{ opacity: 0.6 }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="w-10 !bg-teal-500"
          style={{ opacity: 0.6 }}
        />
      </div>
    );
  };

  // Custom group node component for task groups
  const GroupNode = ({ data }: { data: { label: string } }) => {
    return (
      <div className="text-xs font-medium text-gray-700 p-2">
        {data.label}
      </div>
    );
  };
  
  // Define node types
  const nodeTypes = useMemo(() => ({
    taskNode: CustomTaskNode,
    group: GroupNode,
  }), []);

  // Convert tasks to React Flow nodes and edges
  const { nodes, edges } = useMemo(() => {
    console.log('Creating task elements, tasks count:', tasks.length);
    if (!tasks || tasks.length === 0) {
      console.log('No tasks available, returning empty arrays');
      return { nodes: [], edges: [] };
    }
    
    // Debug: Check if tasks have the expected structure
    tasks.forEach((task: Task) => {
      console.log(`Task ${task.id} structure:`, {
        id: task.id,
        title: task.title,
        hasSubtasks: task.subtasks ? true : false,
        subtasksCount: task.subtasks?.length || 0
      });
    });

    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];
    const taskMap = new Map<string, { task: Task, x: number, y: number }>();
    // Constants for node positioning
    const HORIZONTAL_SPACING = 350; // Increased for better edge visibility
    const VERTICAL_SPACING = 250; // Increased for better edge visibility
    
    // Create a flattened array of all tasks and subtasks
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
    
    // Get all tasks including subtasks
    const allTasks = flattenTasks(tasks);
    console.log('All tasks including subtasks:', allTasks.length);
    
    // First organize tasks into a hierarchy for better positioning
    const topLevelTasks = tasks.filter(task => !task.parent_task_id);
    console.log('Top level tasks:', topLevelTasks.length);
    
    // Map to track which tasks have been positioned
    const positionedTasks = new Set<string>();
    
    // Function to position a task and its subtasks
    const positionTaskHierarchy = (task: Task, level: number, position: number, parentX?: number, parentY?: number) => {
      // Calculate position
      let x: number;
      let y: number;
      
      if (level === 0) {
        // Top level tasks in a row at the top
        x = 100 + position * HORIZONTAL_SPACING;
        y = 100;
      } else {
        // Subtasks below their parent, slightly offset
        x = (parentX || 0) + (position - Math.floor(task.subtasks?.length || 0) / 2) * (HORIZONTAL_SPACING / 2);
        y = (parentY || 0) + VERTICAL_SPACING;
      }
      
      // Create the task element
      console.log(`Creating element for task ${task.id} at position (${x}, ${y})`);
      
      // Add to taskMap and mark as positioned
      taskMap.set(task.id, { task, x, y });
      positionedTasks.add(task.id);
      
      // Position subtasks if any
      if (task.subtasks && task.subtasks.length > 0) {
        task.subtasks.forEach((subtask, idx) => {
          positionTaskHierarchy(subtask, level + 1, idx, x, y);
        });
      }
      
      return { x, y };
    };
    
    // Position all top-level tasks and their subtasks
    topLevelTasks.forEach((task, index) => {
      positionTaskHierarchy(task, 0, index);
    });
    
    // Group independent tasks (no parent, no subtasks, no dependencies)
    const independentTasks = allTasks.filter(task => {
      const hasParent = !!task.parent_task_id;
      const hasSubtasks = task.subtasks && task.subtasks.length > 0;
      const isPositioned = positionedTasks.has(task.id);
      return !hasParent && !hasSubtasks && !isPositioned;
    });
    
    console.log('Independent tasks:', independentTasks.length);
    
    // Create a sub-flow for independent tasks
    if (independentTasks.length > 0) {
      // Create a parent container node for the sub-flow
      const SUBFLOW_X = 800;
      const SUBFLOW_Y = 100;
      
      // Group independent tasks by status for better organization
      const tasksByStatus = independentTasks.reduce((acc, task) => {
        const status = task.status || 'unknown';
        if (!acc[status]) acc[status] = [];
        acc[status].push(task);
        return acc;
      }, {} as Record<string, Task[]>);
      
      // Position tasks by status groups
      let statusGroupY = SUBFLOW_Y;
      
      Object.entries(tasksByStatus).forEach(([statusKey, tasks]) => {
        const tasksPerRow = 3;
        const formattedStatus = statusKey.replace(/_/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        
        // Calculate group dimensions
        const rowsInGroup = Math.ceil(tasks.length / tasksPerRow);
        const groupWidth = (tasksPerRow * (HORIZONTAL_SPACING / 1.5)) + 50;
        const groupHeight = (rowsInGroup * (VERTICAL_SPACING / 1.5)) + 50;
        
        // Create a group node for this status
        flowNodes.push({
          id: `group-${statusKey}`,
          type: 'group',
          position: { x: SUBFLOW_X - 25, y: statusGroupY - 30 },
          style: {
            width: groupWidth,
            height: groupHeight,
            backgroundColor: `${getStatusColor(statusKey)}15`,
            border: `1px dashed ${getStatusColor(statusKey)}`,
            borderRadius: '8px',
            padding: '10px',
            zIndex: -1,
          },
          data: { label: `${formattedStatus} Tasks (${tasks.length})` },
        });
        
        // Position each task in the status group
        tasks.forEach((task, index) => {
          const row = Math.floor(index / tasksPerRow);
          const col = index % tasksPerRow;
          
          // Position tasks in a grid within their status group
          const x = SUBFLOW_X + col * (HORIZONTAL_SPACING / 1.5);
          const y = statusGroupY + row * (VERTICAL_SPACING / 1.5);
          
          taskMap.set(task.id, { task, x, y });
        });
        
        // Update Y position for next group
        statusGroupY += groupHeight + 30;
      });
    }
    
    // Position any remaining tasks that weren't in the hierarchy or independent
    let remainingPosition = 0;
    allTasks.forEach((task) => {
      if (!positionedTasks.has(task.id) && !taskMap.has(task.id)) {
        const row = Math.floor(remainingPosition / 3);
        const col = remainingPosition % 3;
        
        const x = 100 + col * HORIZONTAL_SPACING;
        const y = 500 + row * VERTICAL_SPACING; // Place remaining tasks at the bottom
        
        taskMap.set(task.id, { task, x, y });
        remainingPosition++;
      }
    });
    
    // Now create nodes for all tasks based on their positions
    console.log('Creating nodes based on positioned tasks');
    allTasks.forEach((task: Task) => {
      const position = taskMap.get(task.id);
      if (!position) {
        console.log(`Warning: No position found for task ${task.id}`);
        return;
      }
      
      const { x, y } = position;
      
      // Determine if this is a parent task (has subtasks)
      const isParentTask = task.subtasks && task.subtasks.length > 0;
      
      // Create a node for this task
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
        },
        style: {
          // Add subtle highlighting for parent tasks
          boxShadow: isParentTask ? '0 0 8px rgba(0, 0, 0, 0.15)' : undefined,
        }
      };
      
      flowNodes.push(node);
    });
    
    // Create edges for parent-child relationships and dependencies
    console.log('Creating edges for connections');
    
    // Process all tasks to create appropriate edges
    allTasks.forEach((task: Task) => {
      // 1. Connect parent tasks to their subtasks
      if (task.subtasks && task.subtasks.length > 0) {
        task.subtasks.forEach((subtask: Task) => {
          // Basic edge structure: { id: '1-2', source: '1', target: '2' }
          flowEdges.push({
            id: `${task.id}-${subtask.id}`,
            source: task.id,
            target: subtask.id,
            // Visual enhancements
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
      
      // 2. Connect tasks to their parent if they have parent_task_id
      if (task.parent_task_id) {
        // Check if this connection already exists through subtasks
        const parentTask = allTasks.find(t => t.id === task.parent_task_id);
        const alreadyConnected = parentTask?.subtasks?.some(st => st.id === task.id);
        
        if (parentTask && !alreadyConnected) {
          flowEdges.push({
            id: `${task.parent_task_id}-${task.id}`,
            source: task.parent_task_id,
            target: task.id,
            // Visual enhancements
            label: 'Parent',
            labelStyle: { fill: '#2b6cb0', fontWeight: 600, fontSize: 12 },
            labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
            labelBgPadding: [6, 3] as [number, number],
            labelShowBg: true,
            type: 'smoothstep',
            style: { stroke: '#2b6cb0', strokeWidth: 3, strokeDasharray: '8,4' },
            markerEnd: MarkerType.ArrowClosed,
          });
        }
      }
      
      // 3. Add edges for specific dependency types if not already connected
      if (task.dependency_type && task.parent_task_id) {
        // Skip if already connected through one of the methods above
        const alreadyConnected = flowEdges.some(edge => 
          edge.source === task.parent_task_id && edge.target === task.id
        );
        
        if (!alreadyConnected) {
          // Get styling based on dependency type
          const dependencyStyle = getDependencyStyle(task.dependency_type);
          
          flowEdges.push({
            id: `${task.parent_task_id}-${task.id}-dep`,
            source: task.parent_task_id,
            target: task.id,
            ...dependencyStyle,
          });
        }
      }
    });
    
    return { nodes: flowNodes, edges: flowEdges };
  }, [tasks]);

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-x-4">
            <Heading level="h2">{t("Task Canvas")}</Heading>
          </div>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("View Tasks"),
                    icon: <Eye />,
                    onClick: () => navigate(`/designs/${design.id}/tasks`),
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="px-6 py-4">
        <RouteFocusModal>
          <RouteFocusModal.Header></RouteFocusModal.Header>
          <RouteFocusModal.Title></RouteFocusModal.Title>
          <RouteFocusModal.Body>
            <div className="relative h-[700px]" style={{ width: '100%' }}>
              <ReactFlowProvider>
                {nodes.length > 0 ? (
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
                    attributionPosition="bottom-right"
                    minZoom={0.2}
                    maxZoom={1.5}
                    defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
                  >
                    <Background gap={16} size={1} />
                    <Controls />
                  </ReactFlow>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <p className="text-gray-500">{t("No tasks available")}</p>
                  </div>
                )}
              </ReactFlowProvider>
            </div>
          </RouteFocusModal.Body>
        </RouteFocusModal>
      </div>
    </Container>
  );
}
