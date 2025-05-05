import { useMemo } from "react";
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
import { Tooltip, Text } from "@medusajs/ui";
import { InformationCircle } from "@medusajs/icons";
import { AdminTaskTemplate } from "../../hooks/api/task-templates";

// Interface for the node data
interface TaskTemplateNodeData {
  label: string;
  template: AdminTaskTemplate;
  selected?: boolean;
}

// Props for the component
interface TaskTemplateCanvasProps {
  templates: AdminTaskTemplate[];
  dependencyType?: 'blocking' | 'non_blocking' | 'related';
  onTemplateClick?: (templateId: string) => void;
  selectedTemplates?: string[];
  readOnly?: boolean;
  className?: string;
}

export function TaskTemplateCanvas({ 
  templates, 
  dependencyType = 'blocking',
  onTemplateClick,
  selectedTemplates = [],
  readOnly = false,
  className = ""
}: TaskTemplateCanvasProps) {
  // Function to get dependency style based on type
  const getDependencyStyle = (type: string): {
    color: string;
    strokeWidth: number;
    type: string;
    markerEnd: any;
    label: string;
    labelStyle: { fill: string; fontWeight?: number };
    style?: { strokeDasharray?: string };
  } => {
    switch (type) {
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
      default:
        return {
          color: "#fa5252", // Default to blocking
          strokeWidth: 3,
          type: "straight",
          markerEnd: MarkerType.ArrowClosed,
          label: "Blocking",
          labelStyle: { fill: "#fa5252", fontWeight: 700 }
        };
    }
  };

  // Custom node component for templates
  const TemplateNode = ({ data }: { data: TaskTemplateNodeData }) => {
    const isSelected = selectedTemplates.includes(data.template.id || '');
    
    // Generate template details for tooltip
    const getTemplateDetails = () => {
      // Handle category which might be an object or string
      let categoryText = 'None';
      if (data.template.category) {
        if (typeof data.template.category === 'string') {
          categoryText = data.template.category;
        } else if (typeof data.template.category === 'object' && data.template.category !== null) {
          // If category is an object with a name property, use that
          const categoryObj = data.template.category as { name?: string };
          categoryText = categoryObj.name || 'Unknown Category';
        }
      }
      
      const details = [
        `Category: ${categoryText}`,
        data.template.priority ? `Priority: ${String(data.template.priority)}` : null,
        data.template.estimated_duration ? `Est. Duration: ${String(data.template.estimated_duration)} min` : null,
        data.template.description ? `Description: ${String(data.template.description)}` : null,
      ].filter(Boolean) as string[];
      
      return details.join('\n');
    };
    
    return (
      <div 
        className={`px-3 py-2 shadow-md rounded-md border-2 border-dashed relative cursor-pointer transition-all ${isSelected ? 'border-blue-600 bg-blue-50' : 'border-blue-300 bg-white'}`}
        style={{ width: '150px' }}
        onClick={() => !readOnly && onTemplateClick && onTemplateClick(data.template.id || '')}
      >
        {/* Info icon with tooltip */}
        <div className="absolute -top-2 -right-2 z-10">
          <Tooltip content={getTemplateDetails()}>
            <div className="bg-white rounded-full p-1 shadow-sm border border-gray-200 cursor-help">
              <InformationCircle className="text-gray-500 h-3 w-3" />
            </div>
          </Tooltip>
        </div>
        
        <div className="flex">
          {/* Template icon */}
          <div className="rounded-full w-8 h-8 flex justify-center items-center bg-blue-100">
            📋
          </div>
          
          {/* Template title */}
          <div className="ml-2 overflow-hidden">
            <div className="font-bold text-xs flex items-center">
              <span className="truncate" style={{ maxWidth: '80px' }}>
                {data.label}
              </span>
            </div>
            <div className="text-xs text-gray-500 truncate" style={{ maxWidth: '80px' }}>
              {typeof data.template.category === 'string' 
                ? data.template.category 
                : (data.template.category && typeof data.template.category === 'object') 
                  ? ((data.template.category as { name?: string }).name || 'No category')
                  : 'No category'}
            </div>
          </div>
        </div>
        
        {/* Connection handles */}
        <Handle
          type="target"
          position={Position.Top}
          className="w-10 !bg-blue-500"
          style={{ opacity: 0.6 }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="w-10 !bg-blue-500"
          style={{ opacity: 0.6 }}
        />
      </div>
    );
  };

  // Define node types
  const nodeTypes = useMemo(() => ({
    templateNode: TemplateNode,
  }), [selectedTemplates]);

  // Convert templates to React Flow nodes and edges
  const { nodes, edges } = useMemo(() => {
    if (!templates || templates.length === 0) {
      return { nodes: [], edges: [] };
    }
    
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];
    
    // Constants for node positioning
    const HORIZONTAL_SPACING = 250;
    const START_X = 100;
    const START_Y = 100;
    
    // Create nodes for templates
    templates.forEach((template, index) => {
      // Ensure each template has a unique ID
      const nodeId = template.id || `template-${index}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Process category which might be an object
      let categoryValue = null;
      if (template.category) {
        if (typeof template.category === 'string') {
          categoryValue = template.category;
        } else if (typeof template.category === 'object' && template.category !== null) {
          // If it's an object with a name property, use that
          const categoryObj = template.category as { name?: string };
          categoryValue = categoryObj.name || null;
        }
      }
      
      flowNodes.push({
        id: nodeId,
        type: 'templateNode',
        position: { 
          x: START_X + (index * HORIZONTAL_SPACING), 
          y: START_Y 
        },
        data: {
          label: template.name || `Template ${index + 1}`,
          template: {
            ...template,
            id: nodeId, // Ensure the template in data has the same ID
            category: categoryValue // Ensure category is a string or null
          },
          selected: selectedTemplates.includes(template.id || '')
        }
      });
    });
    
    // Create sequential edges between templates based on dependency type
    const dependencyStyle = getDependencyStyle(dependencyType || 'blocking');
    
    for (let i = 0; i < flowNodes.length - 1; i++) {
      // Create a truly unique edge ID
      const edgeId = `template-edge-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      flowEdges.push({
        id: edgeId,
        source: flowNodes[i].id,
        target: flowNodes[i + 1].id,
        type: 'smoothstep',
        animated: true,
        style: { stroke: dependencyStyle.color, strokeWidth: dependencyStyle.strokeWidth },
        markerEnd: dependencyStyle.markerEnd,
        label: dependencyStyle.label,
        labelStyle: dependencyStyle.labelStyle,
        labelBgStyle: { fill: '#ffffff', opacity: 0.9 },
        labelBgPadding: [6, 3] as [number, number],
        labelShowBg: true,
      });
    }
    
    return { nodes: flowNodes, edges: flowEdges };
  }, [templates, dependencyType, selectedTemplates]);

  // If no templates, show a message
  if (templates.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Text className="text-gray-500 italic">No templates available.</Text>
      </div>
    );
  }

  return (
    <div className={`h-[400px] w-full ${className}`}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={!readOnly}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
