// @ts-nocheck
import React from 'react';
import { NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { usePersons } from '../../../hooks/api/persons'; // Adjust path as needed

export const PersonsWidgetNodeView: React.FC<NodeViewProps> = () => {
  // Call usePersons hook. 
  // The hook returns data in the shape: PaginatedResponse<{ persons: AdminPerson[] }>
  // which should include a 'count' property for the total number of persons.
  // usePersons returns an object like { persons: AdminPerson[], count: number, limit: number, offset: number, ...otherReactQueryProps }
  // We are interested in the top-level 'count' for the total number of persons.
  const { count, isLoading, error, isSuccess } = usePersons();

  return (
    <NodeViewWrapper className="persons-widget-node p-2 border rounded bg-ui-bg-subtle my-2">
      <p className="text-ui-fg-subtle text-xs font-semibold">Persons Information</p>
      {isLoading && <span className="text-ui-fg-muted">Loading persons count...</span>}
      {error && <span className="text-ui-fg-error">Error: {error.message || 'Failed to fetch persons count.'}</span>}
      {isSuccess && count !== undefined && (
        <span className="text-ui-fg-base">Total Persons: {count}</span>
      )}
      {isSuccess && count === undefined && !isLoading && (
        <span className="text-ui-fg-muted">Persons count not available.</span>
      )}
    </NodeViewWrapper>
  );
};
