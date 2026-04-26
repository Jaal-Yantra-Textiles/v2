import { useState, useEffect, useRef } from "react";
import { Button, Input, Text, toast, Textarea, IconButton, Select, Heading, Badge, Switch, Label } from "@medusajs/ui";
import { PlusMini, Trash } from "@medusajs/icons";
import { Plus, Minus } from "@medusajs/icons";

type JsonValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';

// Define the structure for a row in our editor
interface EditorRow {
  id: string; // Unique identifier for the row
  key: string; // The key name for this row
  type: JsonValueType; // The data type of this row
  value: any; // The value of this row
  expanded: boolean; // Whether this row is expanded to show subrows
  subrows: EditorRow[]; // Array of subrows (for nested structures), always initialized
}

interface JsonKeyValueEditorProps {
  label: string;
  initialValue: string | Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  className?: string;
}

export const JsonKeyValueEditor = ({ 
  label, 
  initialValue, 
  onChange,
  className = ""
}: JsonKeyValueEditorProps) => {
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonValue, setRawJsonValue] = useState("");
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  
  // Track expanded row IDs to preserve expanded state during re-initialization
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  
  // Use refs to store the current state without triggering re-renders
  const rowsRef = useRef<EditorRow[]>([]);
  const initialValueRef = useRef<any>(null);
  const isInitialLoad = useRef<boolean>(true);
  
  // Generate a stable ID based on the path in the JSON structure
  const generateStableId = (path: string[]): string => {
    return path.join('.');
  };
  
  // Helper function to restore expanded state for rows based on expandedRowIds
  const restoreExpandedState = (rows: EditorRow[], expandedIds: Set<string>): EditorRow[] => {
    return rows.map(row => {
      // Create a new row object to avoid mutation
      const updatedRow = { ...row };
      
      // Restore expanded state if this row ID is in the expandedIds set
      if (expandedIds.has(row.id)) {
        updatedRow.expanded = true;
      }
      
      // Recursively restore expanded state for subrows
      if (row.subrows && row.subrows.length > 0) {
        updatedRow.subrows = restoreExpandedState(row.subrows, expandedIds);
      }
      
      return updatedRow;
    });
  };
  
  // Initialize the component with the initial value
  useEffect(() => {
    // Skip if this is not the initial load and the value hasn't actually changed
    // Use a more reliable comparison that ignores formatting differences
    const valueChanged = JSON.stringify(initialValue) !== JSON.stringify(initialValueRef.current);
    
    // Skip re-initialization if we're already editing and the parent is just reflecting our changes back
    if (!isInitialLoad.current && !valueChanged) {
      return;
    }
    
    // Update ref values
    initialValueRef.current = initialValue;
    isInitialLoad.current = false;
    
    try {
      let parsedValue: Record<string, any>;
      
      // Handle different types of initialValue
      if (typeof initialValue === 'string') {
        try {
          parsedValue = JSON.parse(initialValue);
        } catch (e) {
          parsedValue = {};
          console.error("Failed to parse JSON string:", e);
        }
      } else if (typeof initialValue === 'object' && initialValue !== null) {
        parsedValue = initialValue;
      } else {
        parsedValue = {};
      }
      
      // Set the raw JSON value
      setRawJsonValue(JSON.stringify(parsedValue, null, 2));
      
      // Convert to rows structure
      const newRows: EditorRow[] = [];
      
      if (typeof parsedValue === 'object' && parsedValue !== null) {
        Object.entries(parsedValue).forEach(([key, value]) => {
          const row = createRowFromValue(key, value);
          newRows.push(row);
        });
      }
      
      // Get a snapshot of the current expanded row IDs
      const currentExpandedIds = expandedRowIds;
      
      console.log('Setting initial rows:', newRows);
      console.log('Row IDs:', newRows.map(row => row.id));
      console.log('Preserving expanded state for IDs:', Array.from(currentExpandedIds));
      
      // Restore expanded state for rows that were previously expanded
      if (currentExpandedIds.size > 0) {
        const rowsWithExpandedState = restoreExpandedState(newRows, currentExpandedIds);
        setRows(rowsWithExpandedState);
      } else {
        setRows(newRows);
      }
    } catch (error) {
      console.error("Failed to process initial value:", error);
      setJsonError("Invalid format");
      setRawJsonValue(typeof initialValue === 'string' ? initialValue : "{}");
    }
  }, [initialValue, expandedRowIds]);  // Also depends on expandedRowIds to restore expanded state
  
  // Helper function to create a row from a value with path tracking for stable IDs
  const createRowFromValue = (key: string, value: any, path: string[] = []): EditorRow => {
    let type: JsonValueType = 'string';
    let subrows: EditorRow[] = []; // Initialize as empty array by default
    
    // Create a current path for this row
    const currentPath = [...path, key];
    
    if (typeof value === 'number') {
      type = 'number';
    } else if (typeof value === 'boolean') {
      type = 'boolean';
    } else if (Array.isArray(value)) {
      type = 'array';
      subrows = value.map((item, index) => {
        return createRowFromValue(index.toString(), item, currentPath);
      });
    } else if (typeof value === 'object' && value !== null) {
      type = 'object';
      subrows = Object.entries(value).map(([subKey, subValue]) => {
        return createRowFromValue(subKey, subValue, currentPath);
      });
    }
    
    // Generate a stable ID based on the path
    const stableId = generateStableId(currentPath);
    
    return {
      id: stableId,
      key,
      value: type === 'array' || type === 'object' ? {} : value,
      type,
      // Set expanded to false by default for all rows
      expanded: false,
      subrows: subrows // Always an array, no need for || []
    };
  };
  
  // Debug effect to track rows changes
  // useEffect(() => {
  //   console.log('Rows state updated:', rows);
  // }, [rows]);
  
  // Helper function to create an object from the current rows structure
  const createObjectFromRows = (rowsToConvert: EditorRow[]): Record<string, any> => {
    const obj: Record<string, any> = {};
    
    rowsToConvert.forEach(row => {
      // Include all rows, even with empty keys (assign a simple temporary key)
      const key = row.key.trim() ? row.key : `__empty_key`;
      
      // Handle different types of values
      if (row.type === 'object' && row.subrows.length > 0) {
        obj[key] = createObjectFromRows(row.subrows);
      } else if (row.type === 'array' && row.subrows.length > 0) {
        // For arrays, we need to convert the subrows to an array
        // Sort subrows by their numeric keys if possible
        const sortedSubrows = [...row.subrows].sort((a, b) => {
          const aNum = parseInt(a.key);
          const bNum = parseInt(b.key);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }
          return a.key.localeCompare(b.key);
        });
        
        obj[key] = sortedSubrows.map(subrow => {
          if (subrow.type === 'object' && subrow.subrows.length > 0) {
            return createObjectFromRows(subrow.subrows);
          } else if (subrow.type === 'array' && subrow.subrows.length > 0) {
            return subrow.subrows.map(sr => sr.value);
          } else {
            return subrow.value;
          }
        });
      } else {
        obj[key] = row.value;
      }
    });
    
    return obj;
  };
  
  // Notify parent component of changes
  const notifyParent = (rowsToConvert: EditorRow[]) => {
    try {
      const obj = createObjectFromRows(rowsToConvert);
      console.log('Notifying parent with:', obj);
      onChange(obj);
    } catch (error) {
      console.error("Failed to notify parent of changes:", error);
    }
  };
  
  // Handle raw JSON changes
  const handleRawJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setRawJsonValue(value);
    
    try {
      const parsed = JSON.parse(value);
      setJsonError(null);
      onChange(parsed);
    } catch (error) {
      setJsonError("Invalid JSON format");
      // Still update the raw value but don't call onChange
    }
  };
  
  // Apply raw JSON to rows
  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(rawJsonValue);
      const newRows: EditorRow[] = [];
      
      if (typeof parsed === 'object' && parsed !== null) {
        Object.entries(parsed).forEach(([key, value]) => {
          const row = createRowFromValue(key, value);
          newRows.push(row);
        });
      }
      
      setRows(newRows);
      setJsonError(null);
      onChange(parsed);
    } catch (error) {
      console.error("Failed to apply raw JSON:", error);
      setJsonError("Invalid JSON format");
      toast.error("Invalid JSON format");
    }
  };
  
  // Add a new row
  const addRow = () => {
    // Generate a stable ID for the new top-level row
    const topLevelIndex = rowsRef.current.length;
    const stableId = generateStableId([`top_${topLevelIndex}`]);
    
    const newRow: EditorRow = {
      id: stableId,
      key: "",
      value: "",
      type: 'string',
      expanded: false,
      subrows: [] // Initialize with empty array
    };
    
    setRows(prevRows => {
      const updatedRows = [...prevRows, newRow];
      // Don't notify parent immediately when adding a row
      // The parent will be notified when the user edits the row's key/value
      // This prevents the modal from closing prematurely
      // notifyParent(updatedRows);
      return updatedRows;
    });
  };
  
  // Add a subrow to a row
  const addSubrow = (rowId: string) => {
    setRows(prevRows => {
      // Create a deep copy of the rows to avoid reference issues
      const updatedRows = JSON.parse(JSON.stringify(prevRows));
      
      // Keep track of the newly expanded rows
      const newlyExpandedRowIds = new Set<string>();
      
      // Find the row to add a subrow to and collect all parent rows in the path
      const findAndAddSubrow = (rows: EditorRow[], parentRows: EditorRow[] = []): boolean => {
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].id === rowId) {
            // Create a new subrow
            // For arrays, use the current length as the key (index)
            let newKey = "";
            if (rows[i].type === 'array') {
              // Get the length of subrows (now always defined)
              const subrowsLength = rows[i].subrows.length;
              newKey = subrowsLength.toString();
            }
            
            // Build the path by traversing up from the current row
            const buildPath = (targetRow: EditorRow, rows: EditorRow[], parentPath: string[] = []): string[] => {
              for (const row of rows) {
                if (row.id === targetRow.id) {
                  return [...parentPath, row.key];
                }
                
                if (row.subrows && row.subrows.length > 0) {
                  const path = buildPath(targetRow, row.subrows, [...parentPath, row.key]);
                  if (path.length > 0) {
                    return path;
                  }
                }
              }
              return [];
            };
            
            // Get the path for the parent row
            const parentPath = buildPath(rows[i], updatedRows);
            
            // Generate a stable ID for the new subrow
            const subrowId = generateStableId([...parentPath, newKey]);
            
            const newSubrow: EditorRow = {
              id: subrowId,
              key: newKey,
              value: "",
              type: 'string',
              expanded: false,
              subrows: [] // Initialize with empty array
            };
            
            // Add the new subrow
            rows[i].subrows.push(newSubrow);
            
            // Ensure the target row is expanded to show the new subrow
            rows[i].expanded = true;
            newlyExpandedRowIds.add(rows[i].id);
            
            // Also expand all parent rows in the path
            for (const parentRow of parentRows) {
              parentRow.expanded = true;
              newlyExpandedRowIds.add(parentRow.id);
            }
            
            // Set the selected row ID to the newly created subrow
            // This ensures focus moves to the new property
            setSelectedRowId(newSubrow.id);
            
            return true;
          }
          
          // Recursively search in subrows if they exist
          if (rows[i].subrows.length > 0) {
            // Pass the current row as part of the parent path
            const newParentRows = [...parentRows, rows[i]];
            if (findAndAddSubrow(rows[i].subrows, newParentRows)) {
              return true;
            }
          }
        }
        
        return false;
      };
      
      findAndAddSubrow(updatedRows);
      
      // Store the expanded state in rowsRef for persistence
      rowsRef.current = updatedRows;
      
      // Update the expandedRowIds state with the newly expanded rows
      setExpandedRowIds(prevExpandedIds => {
        const newExpandedIds = new Set(prevExpandedIds);
        newlyExpandedRowIds.forEach(id => newExpandedIds.add(id));
        return newExpandedIds;
      });
      
      // Log the expanded rows for debugging
      console.log('Newly expanded row IDs:', Array.from(newlyExpandedRowIds));
      
      // Don't notify parent immediately when adding a subrow
      // The parent will be notified when the user edits the subrow's key/value
      // This prevents the modal from closing prematurely
      // notifyParent(updatedRows);
      return updatedRows;
    });
  };
  
  // Remove a row or subrow
  const removeRow = (rowId: string) => {
    setRows(prevRows => {
      const updatedRows = [...prevRows];
      
      // Find and remove the row
      // Use a type guard to ensure rows is always an array
      const findAndRemoveRow = (rows: EditorRow[]): boolean => {
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].id === rowId) {
            rows.splice(i, 1);
            return true;
          }
          
          // Recursively search in subrows if they exist
          if (rows[i].subrows.length > 0) {
            // Subrows is now always defined
            const subrows = rows[i].subrows;
            if (findAndRemoveRow(subrows)) {
              return true;
            }
          }
        }
        
        return false;
      };
      
      findAndRemoveRow(updatedRows);
      rowsRef.current = updatedRows;
      // Immediately notify parent of the changes instead of scheduling
      notifyParent(updatedRows);
      return updatedRows;
    });
  };
  
  // Store the timeout ID for debounced updates
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Update a row's key or value with debouncing to maintain focus
  const updateRow = (rowId: string, field: 'key' | 'value' | 'type', newValue: any) => {
    setRows(prevRows => {
      const updatedRows = [...prevRows];
      
      // Keep track of the path to the target row to ensure all parent rows stay expanded
      const rowPath: EditorRow[] = [];
      
      // Find and update the row
      const findAndUpdateRow = (rows: EditorRow[], parentRows: EditorRow[] = []): boolean => {
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].id === rowId) {
            // Add this row to the path
            rowPath.push(rows[i]);
            
            if (field === 'type') {
              // Handle type changes
              const newType = newValue as JsonValueType;
              
              // Convert the value based on the new type
              let convertedValue: any = rows[i].value;
              
              if (newType === 'string') {
                convertedValue = String(rows[i].value || "");
              } else if (newType === 'number') {
                convertedValue = Number(rows[i].value || 0);
              } else if (newType === 'boolean') {
                convertedValue = Boolean(rows[i].value);
              } else if (newType === 'object') {
                convertedValue = {};
                // If changing to object, initialize with empty subrows
                rows[i].subrows = [];
                // Ensure it's expanded when changing to an object
                rows[i].expanded = true;
              } else if (newType === 'array') {
                convertedValue = [];
                // If changing to array, initialize with empty subrows
                rows[i].subrows = [];
                // Ensure it's expanded when changing to an array
                rows[i].expanded = true;
              }
              
              rows[i].type = newType;
              rows[i].value = convertedValue;
            } else {
              // Update the field
              rows[i][field] = newValue;
            }
            
            // Also ensure all parent rows in the path remain expanded
            for (const parentRow of parentRows) {
              parentRow.expanded = true;
            }
            
            return true;
          }
          
          // Recursively search in subrows if they exist
          if (rows[i].subrows.length > 0) {
            // Pass the current row as part of the parent path
            const newParentRows = [...parentRows, rows[i]];
            if (findAndUpdateRow(rows[i].subrows, newParentRows)) {
              return true;
            }
          }
        }
        
        return false;
      };
      
      findAndUpdateRow(updatedRows);
      
      // Debounce the parent notification to prevent focus loss
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      
      updateTimeoutRef.current = setTimeout(() => {
        // Store the current value to prevent re-initialization
        const jsonObject = createObjectFromRows(updatedRows);
        initialValueRef.current = jsonObject;
        
        // Notify parent
        onChange(jsonObject);
        updateTimeoutRef.current = null;
      }, 500); // Increased debounce time to 500ms for better typing experience
      
      return updatedRows;
    });
  };
  
  // Toggle a row's expanded state
  const toggleRowExpanded = (rowId: string) => {
    setRows(prevRows => {
      const updatedRows = [...prevRows];
      let isExpanded = false;
      
      // Find and toggle the row's expanded state
      // Use a type guard to ensure rows is always an array
      const findAndToggleRow = (rows: EditorRow[]): boolean => {
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].id === rowId) {
            // Toggle expanded state
            rows[i].expanded = !rows[i].expanded;
            isExpanded = rows[i].expanded;
            return true;
          }
          
          // Recursively search in subrows if they exist
          if (rows[i].subrows.length > 0) {
            // Subrows is now always defined
            const subrows = rows[i].subrows;
            if (findAndToggleRow(subrows)) {
              return true;
            }
          }
        }
        
        return false;
      };
      
      findAndToggleRow(updatedRows);
      rowsRef.current = updatedRows;
      
      // Update expandedRowIds to track which rows are expanded
      setExpandedRowIds(prevExpandedIds => {
        const newExpandedIds = new Set(prevExpandedIds);
        if (isExpanded) {
          newExpandedIds.add(rowId);
        } else {
          newExpandedIds.delete(rowId);
        }
        return newExpandedIds;
      });
      
      // No need to notify parent for UI-only changes like expanding/collapsing
      return updatedRows;
    });
  };
  
  // Set the selected row
  const selectRow = (rowId: string | null) => {
    setSelectedRowId(rowId);
  };
  
  // Render a row
  const renderRow = (row: EditorRow, depth: number = 0) => {
    const isSelected = selectedRowId === row.id;
    const hasSubrows = row.subrows && row.subrows.length > 0;
    const isArrayOrObject = row.type === 'array' || row.type === 'object';
    
    return (
      <div 
        key={row.id} 
        className={`mb-2 ${depth > 0 ? 'ml-4 pl-2 border-l border-ui-border-base' : ''}`}
      >
        <div 
          className={`flex items-start gap-2 p-2 border rounded-md ${isSelected ? 'border-ui-border-interactive bg-ui-bg-subtle' : 'border-ui-border-base'}`}
          onClick={() => selectRow(row.id)}
        >
          <div className="flex-1 grid grid-cols-12 gap-2">
            {/* Key input - for arrays at depth 0, we show the key */}
            {(row.type !== 'array' || depth === 0) && (
              <div className="col-span-4">
                <Input
                  placeholder="Key"
                  value={row.key.startsWith('__empty_key') ? '' : row.key}
                  onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                />
              </div>
            )}
            
            {/* Type selector */}
            <div className={`${row.type !== 'array' || depth === 0 ? 'col-span-2' : 'col-span-6'}`}>
              <Select
                value={row.type}
                onValueChange={(value) => updateRow(row.id, 'type', value)}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Type" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="string">String</Select.Item>
                  <Select.Item value="number">Number</Select.Item>
                  <Select.Item value="boolean">Boolean</Select.Item>
                  <Select.Item value="object">Object</Select.Item>
                  <Select.Item value="array">Array</Select.Item>
                </Select.Content>
              </Select>
            </div>
            
            {/* Value input or preview */}
            <div className="col-span-6">
              {row.type === 'string' && (
                <Input
                  placeholder="Value"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                />
              )}
              {row.type === 'number' && (
                <Input
                  type="number"
                  placeholder="Value"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, 'value', Number(e.target.value))}
                />
              )}
              {row.type === 'boolean' && (
                <Select
                  value={row.value === true ? "true" : "false"}
                  onValueChange={(value) => updateRow(row.id, 'value', value === "true")}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Value" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="true">True</Select.Item>
                    <Select.Item value="false">False</Select.Item>
                  </Select.Content>
                </Select>
              )}
              {isArrayOrObject && (
                <div className="flex items-center gap-2">
                  <Badge>
                    {row.type === 'array' 
                      ? `Array (${row.subrows?.length || 0} items)` 
                      : `Object (${row.subrows?.length || 0} props)`}
                  </Badge>
                  
                  {/* Expand/collapse button */}
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRowExpanded(row.id);
                    }}
                  >
                    {row.expanded ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </Button>
                  
                  {/* Add subrow button */}
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      addSubrow(row.id);
                    }}
                  >
                    <PlusMini className="w-4 h-4 mr-1" />
                    {row.type === 'array' ? 'Add Item' : 'Add Property'}
                  </Button>
                </div>
              )}
            </div>
          </div>
          
          {/* Remove button */}
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              removeRow(row.id);
            }}
            variant="transparent"
            size="small"
          >
            <Trash className="w-4 h-4" />
          </IconButton>
        </div>
        
        {/* Render subrows if expanded */}
        {row.expanded && hasSubrows && (
          <div className="mt-2">
            {row.subrows!.map(subrow => renderRow(subrow, depth + 1))}
          </div>
        )}
      </div>
    );
  };
  
  return (
    <div className={`border rounded-md p-4 w-full ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <Heading className="text-base font-medium">{label}</Heading>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor={`raw-json-${label}`} className="text-sm">Raw JSON</Label>
            <Switch
              id={`raw-json-${label}`}
              checked={showRawJson}
              onCheckedChange={setShowRawJson}
            />
          </div>
          {!showRawJson && (
            <Button
              variant="secondary"
              size="small"
              onClick={addRow}
            >
              <PlusMini className="w-4 h-4 mr-1" />
              Add Row
            </Button>
          )}
        </div>
      </div>
      
      {showRawJson ? (
        <div className="w-full">
          <Textarea
            value={rawJsonValue}
            onChange={handleRawJsonChange}
            rows={10}
            className={`font-mono text-sm ${jsonError ? 'border-red-500' : ''}`}
          />
          {jsonError && (
            <Text className="text-red-500 text-sm mt-1">{jsonError}</Text>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              size="small"
              onClick={applyRawJson}
              disabled={!!jsonError}
            >
              Apply Changes
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4 p-3 bg-ui-bg-base border border-ui-border-base rounded-md">
            <Text className="text-sm text-ui-fg-subtle">
              Click on a row to select it. Use the "Add Row" button to add a new top-level field, or add subrows to create nested structures.
            </Text>
          </div>
          
          {rows.length === 0 ? (
            <div className="flex items-center justify-center p-4 border border-dashed rounded-md">
              <Text className="text-ui-fg-subtle">No rows added yet. Click "Add Row" to start.</Text>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map(row => renderRow(row))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
