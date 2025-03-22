import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { RouteFocusModal } from "../modal/route-focus-modal";
import "@excalidraw/excalidraw/index.css"; 
import { useCallback, useMemo } from "react";
import { AdminDesign } from "../../hooks/api/designs";
import { Container, Heading } from "@medusajs/ui";
import { ActionMenu } from "../common/action-menu";
import { Eye } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminDesignTask } from "../../hooks/api/design-tasks";

// We'll use 'any' type for Excalidraw elements to avoid import issues


// Extend the AdminDesignTask interface with any additional properties needed for visualization
interface Task extends AdminDesignTask {
  // Additional properties for visualization if needed
  subtasks?: Task[];
  [key: string]: any;
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
  const handleExcalidrawChange = useCallback(() => {
    // Prevent modal state reset
  }, []);

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
    console.log(dependencyType)
    switch (dependencyType) {
      case "blocking":
        return {
          strokeColor: "#fa5252", // Red for blocking dependencies
          strokeWidth: 3,
          strokeStyle: "solid" as const,
          label: "Blocking"
        };
      case "non_blocking":
        return {
          strokeColor: "#4dabf7", // Blue for non-blocking dependencies
          strokeWidth: 2,
          strokeStyle: "solid" as const,
          label: "Non-blocking"
        };
      case "related":
        return {
          strokeColor: "#8ce99a", // Green for related tasks
          strokeWidth: 2,
          strokeStyle: "dashed" as const,
          label: "Related"
        };
      case "subtask":
      default:
        return {
          strokeColor: "#1864ab", // Default blue for subtasks
          strokeWidth: 2,
          strokeStyle: "solid" as const,
          label: "Subtask"
        };
    }
  };

  // Function to get priority color for stroke
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

  // Convert tasks to Excalidraw elements
  const taskElements = useMemo(() => {
    console.log('Creating task elements, tasks count:', tasks.length)
    if (!tasks || tasks.length === 0) {
      console.log('No tasks available, returning empty array')
      return [];
    }
    
    // Debug: Check if tasks have the expected structure
    tasks.forEach((task: Task) => {
      console.log(`Task ${task.id} structure:`, {
        id: task.id,
        title: task.title,
        hasSubtasks: task.subtasks ? true : false,
        subtasksCount: task.subtasks?.length || 0
      })
    })

    const elements: any[] = [];
    const taskMap = new Map<string, { task: Task, x: number, y: number }>();
    const TASK_WIDTH = 200;
    const TASK_HEIGHT = 100;
    const HORIZONTAL_SPACING = 300;
    const VERTICAL_SPACING = 200;
    
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
    
    // Position any remaining tasks that weren't in the hierarchy
    let remainingPosition = 0;
    allTasks.forEach((task) => {
      if (!positionedTasks.has(task.id)) {
        const row = Math.floor(remainingPosition / 3);
        const col = remainingPosition % 3;
        
        const x = 100 + col * HORIZONTAL_SPACING;
        const y = 500 + row * VERTICAL_SPACING; // Place remaining tasks at the bottom
        
        taskMap.set(task.id, { task, x, y });
        remainingPosition++;
      }
    });
    
    // Now create elements for all tasks based on their positions
    console.log('Creating elements based on positioned tasks');
    allTasks.forEach((task: Task) => {
      const position = taskMap.get(task.id);
      if (!position) {
        console.log(`Warning: No position found for task ${task.id}`);
        return;
      }
      
      const { x, y } = position;
      
      // Create a unique ID for this task element
      const elementId = `task-${task.id}`;
      const groupId = `group-${task.id}`;
      
      // Create the rectangle element for the task
      const taskElement = {
        id: elementId,
        type: "rectangle" as const,
        x,
        y,
        width: TASK_WIDTH,
        height: TASK_HEIGHT,
        backgroundColor: getStatusColor(task.status),
        strokeColor: getPriorityColor(task.priority),
        strokeWidth: 2,
        roundness: {
          type: 2 as const, // Rounded rectangle
          value: 10,
        },
        fillStyle: "solid" as const,
        locked: true,
        groupIds: [groupId],
      };
      
      // Create text element for task title
      const titleElement = {
        type: "text" as const,
        x: x + TASK_WIDTH / 2 - 80, // Center text
        y: y + 20,
        text: task.title || `Task ${task.id}`,
        fontSize: 16,
        locked: true,
        groupIds: [groupId],
        strokeColor: "#000000",
        textAlign: "center" as const,
        width: 160,
      };
      
      // Create text element for task status
      const statusElement = {
        type: "text" as const,
        x: x + TASK_WIDTH / 2 - 80,
        y: y + 50,
        text: `Status: ${task.status}`,
        fontSize: 12,
        strokeColor: "#666666",
        width: 160,
        locked: true,
        groupIds: [groupId],
      };
      
      // Create text element for task priority if available
      const priorityElement = task.priority ? {
        type: "text" as const,
        x: x + TASK_WIDTH / 2 - 80,
        y: y + 70,
        text: `Priority: ${task.priority}`,
        fontSize: 12,
        strokeColor: "#666666",
        width: 160,
        locked: true,
        groupIds: [groupId],
      } : null;
      
      // Add elements to the array
      elements.push(taskElement);
      elements.push(titleElement);
      elements.push(statusElement);
      if (priorityElement) elements.push(priorityElement);
      
      // Store the task and its position for the second pass
      taskMap.set(task.id, { task, x, y });
      console.log(`Added task ${task.id} to taskMap at position (${x}, ${y})`)
    });
    
    // Second pass: create arrow connections for parent-child relationships and dependencies
    console.log('Starting second pass to create connections')
    allTasks.forEach((task: Task) => {
      console.log(`Processing task ${task.id} for connections`)
      // Process subtasks
      if (task.subtasks && task.subtasks.length > 0) {
        console.log(`Task ${task.id} has ${task.subtasks.length} subtasks`)
        const parent = taskMap.get(task.id);
        
        task.subtasks.forEach((subtask: Task) => {
          console.log(`Processing subtask ${subtask.id}`)
          const child = taskMap.get(subtask.id);
          console.log('Child task in map:', child)
          
          if (parent && child) {
            console.log(`Creating connection from ${task.id} to ${subtask.id}`)
            
            // Get dependency style based on the dependency type
            const dependencyStyle = getDependencyStyle(subtask.dependency_type);
            
            // Create arrow connecting parent to child
            const arrowElement = {
              type: "arrow" as const,
              x: parent.x + TASK_WIDTH / 3, // Moved left from center
              y: parent.y + TASK_HEIGHT,
              // Reduce width and height by 20% to shorten the arrow
              width: ((child.x + TASK_WIDTH / 3) - (parent.x + TASK_WIDTH / 3)) * 0.8,
              height: ((child.y + TASK_HEIGHT / 2) - (parent.y + TASK_HEIGHT)) * 0.8,
              strokeColor: dependencyStyle.strokeColor,
              strokeWidth: dependencyStyle.strokeWidth,
              strokeStyle: dependencyStyle.strokeStyle,
              startArrowhead: null,
              endArrowhead: "arrow" as const,
              start: {
                id: `task-${task.id}`,
              },
              end: {
                id: `task-${subtask.id}`,
              },
              locked: true,
              // Enable curved lines
              roundness: {
                type: 2, // Curved line
              },
            };
            
            // Add label for dependency type
            const labelElement = {
              type: "text" as const,
              x: (parent.x + child.x) / 2 - 40, // Center between tasks
              y: (parent.y + TASK_HEIGHT + child.y) / 2 - 10, // Center vertically
              text: dependencyStyle.label,
              fontSize: 12,
              strokeColor: dependencyStyle.strokeColor,
              backgroundColor: "#ffffff",
              fillStyle: "solid" as const,
              width: 80,
              textAlign: "center" as const,
              locked: true,
            };
            
            elements.push(arrowElement);
            elements.push(labelElement);
          }
        });
      }
      
      // Process other dependencies that might not be subtasks
      allTasks.forEach((otherTask: Task) => {
        if (otherTask.id !== task.id && 
            otherTask.parent_task_id === task.id && 
            !task.subtasks?.some(subtask => subtask.id === otherTask.id)) {
          
          const parent = taskMap.get(task.id);
          const dependent = taskMap.get(otherTask.id);
          
          if (parent && dependent) {
            // Get dependency style based on the dependency type
            const dependencyStyle = getDependencyStyle(otherTask.dependency_type);
            
            // Create arrow connecting tasks
            const arrowElement = {
              type: "arrow" as const,
              x: parent.x + TASK_WIDTH / 3, // Moved left from center
              y: parent.y + TASK_HEIGHT / 2,
              // Reduce width and height by 20% to shorten the arrow
              width: ((dependent.x + TASK_WIDTH / 3) - (parent.x + TASK_WIDTH / 3)) * 0.8,
              height: ((dependent.y + TASK_HEIGHT / 2) - (parent.y + TASK_HEIGHT / 2)) * 0.8,
              strokeColor: dependencyStyle.strokeColor,
              strokeWidth: dependencyStyle.strokeWidth,
              strokeStyle: dependencyStyle.strokeStyle,
              startArrowhead: null,
              endArrowhead: "arrow" as const,
              start: {
                id: `task-${task.id}`,
              },
              end: {
                id: `task-${otherTask.id}`,
              },
              locked: true,
              // Enable curved lines
              roundness: {
                type: 2, // Curved line
              },
            };
            
            // Add label for dependency type
            const labelElement = {
              type: "text" as const,
              x: (parent.x + dependent.x) / 2 - 40, // Center between tasks
              y: (parent.y + dependent.y) / 2 - 10, // Center vertically
              text: dependencyStyle.label,
              fontSize: 12,
              strokeColor: dependencyStyle.strokeColor,
              backgroundColor: "#ffffff",
              fillStyle: "solid" as const,
              width: 80,
              textAlign: "center" as const,
              locked: true,
            };
            
            elements.push(arrowElement);
            elements.push(labelElement);
          }
        }
      });
    });
    
    return convertToExcalidrawElements(elements);
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
            <div className="relative h-[700px]">
              <Excalidraw
                viewModeEnabled={true}
                UIOptions={{
                  canvasActions: {
                    loadScene: true,
                    saveToActiveFile: true,
                    export: { saveFileToDisk: true },
                    toggleTheme: true,
                  },
                }}
                initialData={{
                  elements: taskElements,
                  appState: { 
                    viewBackgroundColor: "#ffffff",
                    // Using a generic zoom object that Excalidraw will handle internally
                    zoom: { value: 1 } as any,
                  },
                  scrollToContent: true,
                }}
                onChange={handleExcalidrawChange}
                detectScroll={true}
                autoFocus={true}
              />
            </div>
          </RouteFocusModal.Body>
        </RouteFocusModal>
      </div>
    </Container>
  );
}
