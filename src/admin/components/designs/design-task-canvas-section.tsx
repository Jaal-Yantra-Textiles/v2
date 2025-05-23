import { useMemo, useState, useRef } from "react";
import { AdminDesign } from "../../hooks/api/designs";
import { Tooltip, Button, Text, Select, DropdownMenu } from "@medusajs/ui";
import { InformationCircle, Plus, ArrowPathMini, MinusMini, PlusMini } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminDesignTask } from "../../hooks/api/design-tasks";
import { useTaskTemplates } from "../../hooks/api/task-templates";
import { TaskTemplateCanvas } from "../tasks/task-template-canvas";

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

// Extend the AdminDesignTask interface with any additional properties needed for visualization
interface Task extends AdminDesignTask {
  subtasks?: Task[]
  incoming?: TaskDependency[]
  outgoing?: TaskDependency[]
  start_date?:  Date | undefined
  end_date?: string | Date | undefined
  // Override the description property to allow null values
  description?: string | undefined
}

// Interface for task dependencies
interface TaskDependency {
  id: string
  dependency_type: 'blocking' | 'non_blocking' | 'related'
  outgoing_task_id: string
  incoming_task_id: string
  metadata?: Record<string, any>
  created_at?: Date
  updated_at?: Date
  deleted_at?: Date | null
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
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [showTemplates, setShowTemplates] = useState<boolean>(false);
  
  // Fetch task templates
  const { task_templates } = useTaskTemplates({
    fields: ["id", "name", "description", "category", "priority", "estimated_duration", "metadata"]
  });
  
  // Get unique categories from templates
  const categories = useMemo(() => {
    if (!task_templates) return [];
    
    const uniqueCategories = new Set<string>();
    task_templates.forEach(template => {
      if (template.category) {
        // Handle both string and object categories
        if (typeof template.category === 'string') {
          uniqueCategories.add(template.category);
        } else if (typeof template.category === 'object' && template.category !== null) {
          // If it's an object, try to get the name property
          const categoryObj = template.category as any;
          if (categoryObj.name) {
            uniqueCategories.add(categoryObj.name);
          }
        }
      }
    });
    
    // Log categories for debugging
    console.log('Unique categories:', Array.from(uniqueCategories));
    
    return Array.from(uniqueCategories).sort();
  }, [task_templates]);
  
  // Filter templates by selected category
  const filteredTemplates = useMemo(() => {
    if (!selectedCategory || !task_templates) return [];
    
    // Log selected category for debugging
    console.log('Selected category:', selectedCategory);
    
    // Ensure each template has a valid ID to use as a key
    return task_templates
      .filter(template => {
        // Handle both string and object categories
        if (typeof template.category === 'string') {
          return template.category === selectedCategory;
        } else if (typeof template.category === 'object' && template.category !== null) {
          const categoryObj = template.category as any;
          return categoryObj.name === selectedCategory;
        }
        return false;
      })
      .map(template => ({
        ...template,
        id: template.id || `template-${Math.random().toString(36).substr(2, 9)}`
      }));
  }, [selectedCategory, task_templates]);
  
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

  // Helper function to get styling for different dependency types
  const getDependencyStyle = (type: string) => {
    switch (type) {
      case 'blocking':
        return {
          style: { stroke: "#fa5252", strokeWidth: 3 },
          type: "straight",
          markerEnd: MarkerType.ArrowClosed,
          label: "Blocking",
          labelStyle: { fill: "#fa5252", fontWeight: 700 },
          labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
          labelBgPadding: [6, 3] as [number, number],
          labelShowBg: true,
          animated: true
        };
      case 'non_blocking':
        return {
          style: { stroke: "#4c6ef5", strokeWidth: 2 },
          type: "smoothstep",
          markerEnd: MarkerType.ArrowClosed,
          label: "Non-blocking",
          labelStyle: { fill: "#4c6ef5", fontWeight: 700 },
          labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
          labelBgPadding: [6, 3] as [number, number],
          labelShowBg: true
        };
      case 'related':
        return {
          style: { stroke: "#40c057", strokeWidth: 2, strokeDasharray: '5,5' },
          type: "bezier",
          markerEnd: MarkerType.ArrowClosed,
          label: "Related",
          labelStyle: { fill: "#40c057", fontWeight: 700 },
          labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
          labelBgPadding: [6, 3] as [number, number],
          labelShowBg: true
        };
      default:
        return {
          style: { stroke: "#fa5252", strokeWidth: 3 },
          type: "straight",
          markerEnd: MarkerType.ArrowClosed,
          label: "Blocking",
          labelStyle: { fill: "#fa5252", fontWeight: 700 },
          labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
          labelBgPadding: [6, 3] as [number, number],
          labelShowBg: true,
          animated: true
        };
    }
  };

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
        `Title: ${data.label}`,
        `Status: ${formatStatus(data.status)}`,
        data.priority ? `Priority: ${data.priority}` : null,
        data.task.description ? `Description: ${data.task.description}` : null,
        data.task.start_date ? `Start: ${new Date(data.task.start_date).toLocaleDateString()}` : null,
        data.task.end_date ? `End: ${new Date(data.task.end_date).toLocaleDateString()}` : null,
        data.isParentTask ? `Has Subtasks: ${data.task.subtasks?.length || 0}` : null,
        data.task.outgoing?.length ? `Outgoing Dependencies: ${data.task.outgoing.length}` : null,
        data.task.incoming?.length ? `Incoming Dependencies: ${data.task.incoming.length}` : null,
      ].filter(Boolean) as string[];
      
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
        // Ensure each task has a valid string ID
        const taskWithId = {
          ...task,
          id: task.id || `task-${Math.random().toString(36).substr(2, 9)}`
        };
        result.push(taskWithId);
        if (task.subtasks && task.subtasks.length > 0) {
          // Ensure subtasks have valid IDs too
          const subtasksWithIds = task.subtasks.map(subtask => ({
            ...subtask,
            id: subtask.id || `subtask-${Math.random().toString(36).substr(2, 9)}`
          }));
          taskWithId.subtasks = subtasksWithIds;
          result = result.concat(flattenTasks(subtasksWithIds));
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
        task.subtasks.forEach((subtask: Task, index: number) => {
          // Basic edge structure with unique ID including index to avoid duplicates
          const edgeId = `${task.id}-${subtask.id}-subtask-${index}`;
          flowEdges.push({
            id: edgeId,
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
          // Create a unique edge ID with a timestamp to avoid duplicates
          const edgeId = `${task.parent_task_id}-${task.id}-parent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          flowEdges.push({
            id: edgeId,
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
      
      // 3. Process outgoing dependencies
      if (task.outgoing && task.outgoing.length > 0) {
        task.outgoing.forEach((dependency, i) => {
          // Skip if already connected through one of the methods above
          const alreadyConnected = flowEdges.some(edge => 
            edge.source === dependency.outgoing_task_id && edge.target === dependency.incoming_task_id
          );
          
          if (!alreadyConnected) {
            // Get styling based on dependency type
            const dependencyStyle = getDependencyStyle(dependency.dependency_type);
            
            // Create a unique edge ID
            const edgeId = `outgoing-${dependency.id}-${i}`;
            
            // Add edge from this task to the target task
            flowEdges.push({
              id: edgeId,
              source: dependency.outgoing_task_id,
              target: dependency.incoming_task_id,
              ...dependencyStyle,
              data: { dependency }
            });
          }
        });
      }
      
      // 4. Process incoming dependencies (only if not already added via outgoing)
      if (task.incoming && task.incoming.length > 0) {
        task.incoming.forEach((dependency, i) => {
          // Skip if already connected through outgoing dependencies or other methods
          const alreadyConnected = flowEdges.some(edge => 
            edge.source === dependency.outgoing_task_id && edge.target === dependency.incoming_task_id
          );
          
          if (!alreadyConnected) {
            // Get styling based on dependency type
            const dependencyStyle = getDependencyStyle(dependency.dependency_type);
            
            // Create a unique edge ID
            const edgeId = `incoming-${dependency.id}-${i}`;
            
            // Add edge from source task to this task
            flowEdges.push({
              id: edgeId,
              source: dependency.outgoing_task_id,
              target: dependency.incoming_task_id,
              ...dependencyStyle,
              data: { dependency }
            });
          }
        });
      }
    });
    
    return { nodes: flowNodes, edges: flowEdges };
  }, [tasks]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Top bar with category selector and action button */}
      <div className="p-4 border-b flex justify-between items-center">
        <div className="flex items-center gap-x-4 w-64">
          <Select 
            value={selectedCategory || "none"}
            onValueChange={(value: string) => {
              const category = value === "none" ? "" : value;
              setSelectedCategory(category);
              setShowTemplates(!!category);
            }}
          >
            <Select.Trigger>
              <Select.Value placeholder="Select a template category" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="none">Default</Select.Item>
              {categories.map((category, index) => (
                <Select.Item key={`category-${index}-${category}`} value={category}>
                  {category}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        
        {selectedCategory && (
          <Button 
            variant="secondary" 
            size="small"
            onClick={() => navigate(`/designs/${design.id}/tasks/new?category=${selectedCategory}`)}
          >
            <Plus className="mr-2" />
            Create Tasks from Templates
          </Button>
        )}
      </div>
      
      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main task canvas - takes full height */}
        <div className="flex-1 relative">
          <ReactFlowProvider>
            <EnhancedCanvas 
              nodes={nodes} 
              edges={edges} 
              nodeTypes={nodeTypes} 
              t={t}
            />
          </ReactFlowProvider>
        </div>
        
        {/* Template preview sidebar - only shown when category selected */}
        {selectedCategory && showTemplates && (
          <div className="w-80 border-l p-4 overflow-auto bg-gray-50">
            <div className="mb-3 flex items-center justify-between">
              <Text className="text-sm font-medium">Template Preview</Text>
              <Text className="text-xs text-gray-500">{filteredTemplates.length} templates</Text>
            </div>
            
            {/* Vertical list of templates */}
            <div className="space-y-3 mb-4">
              {filteredTemplates.map((template, index) => (
                <div 
                  key={template.id || index}
                  className="p-3 bg-white border border-gray-200 rounded-md shadow-sm"
                >
                  <div className="font-medium text-sm mb-1">{template.name}</div>
                  {template.category && (
                    <div className="text-xs text-gray-500 mb-1">
                      Category: {typeof template.category === 'string' ? template.category : 
                        (template.category as any)?.name || 'Unknown'}
                    </div>
                  )}
                  {template.priority && (
                    <div className="text-xs inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 mr-1">
                      {template.priority}
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {/* Dependency visualization */}
            <div className="border border-gray-200 rounded-md p-3 bg-white mb-3">
              <Text className="text-xs font-medium mb-2">Dependency Visualization</Text>
              <TaskTemplateCanvas 
                templates={filteredTemplates}
                readOnly={true}
                className="h-[200px] border-0"
              />
            </div>
            
            <Text className="text-xs text-gray-500 italic">
              This preview shows how tasks will be created and linked when using templates from the selected category.
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

// Interface for EnhancedCanvas props
interface EnhancedCanvasProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: any;
  t: (key: string, fallback: string) => string;
}

// Enhanced canvas component with zoom controls
const EnhancedCanvas = ({ nodes, edges, nodeTypes, t }: EnhancedCanvasProps) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const reactFlowInstance = useRef<any>(null);
  
  // For debugging
  console.log('EnhancedCanvas rendering with nodes:', nodes.length, 'edges:', edges.length);
  
  // Zoom functions
  const zoomIn = () => {
    if (reactFlowInstance.current && zoomLevel < 1.5) {
      const newZoom = Math.min(zoomLevel + 0.25, 1.5);
      reactFlowInstance.current.zoomTo(newZoom);
      setZoomLevel(newZoom);
    }
  };

  const zoomOut = () => {
    if (reactFlowInstance.current && zoomLevel > 0.5) {
      const newZoom = Math.max(zoomLevel - 0.25, 0.5);
      reactFlowInstance.current.zoomTo(newZoom);
      setZoomLevel(newZoom);
    }
  };

  const resetZoom = () => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2 });
      setZoomLevel(1);
    }
  };
  
  const handleZoomChange = (value: number) => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.zoomTo(value / 100);
      setZoomLevel(value / 100);
    }
  };

  return (
    <div className="h-[400px] w-full">
      <div className="relative h-full w-full">
        {/* The actual ReactFlow component directly renders the flow */}
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
            className="h-full w-full"
            style={{ borderRadius: 0 }} /* Remove rounded corners */
            onInit={(instance) => {
              reactFlowInstance.current = instance;
            }}
          >
            <Background gap={16} size={1} />
          </ReactFlow>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-gray-500">{t("No tasks available", "No tasks available")}</p>
          </div>
        )}
        <div className="bg-ui-bg-base shadow-borders-base text-ui-fg-subtle absolute bottom-4 left-6 flex h-7 items-center overflow-hidden rounded-md">
          <div className="flex items-center">
            <button
              onClick={zoomIn}
              type="button"
              disabled={zoomLevel >= 1.5}
              aria-label="Zoom in"
              className="disabled:text-ui-fg-disabled transition-fg hover:bg-ui-bg-base-hover active:bg-ui-bg-base-pressed focus-visible:bg-ui-bg-base-pressed border-r p-1 outline-none"
            >
              <PlusMini />
            </button>
            <div>
              <DropdownMenu>
                <DropdownMenu.Trigger className="disabled:text-ui-fg-disabled transition-fg hover:bg-ui-bg-base-hover active:bg-ui-bg-base-pressed focus-visible:bg-ui-bg-base-pressed flex w-[50px] items-center justify-center border-r p-1 outline-none">
                  <Text
                    as="span"
                    size="xsmall"
                    leading="compact"
                    className="select-none tabular-nums"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </Text>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  {[50, 75, 100, 125, 150].map((value) => (
                    <DropdownMenu.Item
                      key={value}
                      onClick={() => handleZoomChange(value)}
                    >
                      {value}%
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu>
            </div>
            <button
              onClick={zoomOut}
              type="button"
              disabled={zoomLevel <= 0.5}
              aria-label="Zoom out"
              className="disabled:text-ui-fg-disabled transition-fg hover:bg-ui-bg-base-hover active:bg-ui-bg-base-pressed focus-visible:bg-ui-bg-base-pressed border-r p-1 outline-none"
            >
              <MinusMini />
            </button>
          </div>
          <button
            onClick={resetZoom}
            type="button"
            aria-label="Reset canvas"
            className="disabled:text-ui-fg-disabled transition-fg hover:bg-ui-bg-base-hover active:bg-ui-bg-base-pressed focus-visible:bg-ui-bg-base-pressed p-1 outline-none"
          >
            <ArrowPathMini />
          </button>
        </div>
      </div>
    </div>
  );
};
