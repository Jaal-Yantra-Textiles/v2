// @ts-nocheck
import React from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { useProducts } from '../../../hooks/api/products'; // Adjust path as needed

export const ProductsWidgetNodeView: React.FC<NodeViewProps> = () => {
  const { count, isLoading, error, isSuccess } = useProducts(); 

  return (
    <NodeViewWrapper className="products-widget-node p-2 border rounded bg-ui-bg-subtle my-2">
      <p className="text-ui-fg-subtle text-xs font-semibold">Product Information</p>
      {isLoading && <span className="text-ui-fg-muted">Loading product count...</span>}
      {error && <span className="text-ui-fg-error">Error: {error.message || 'Failed to fetch product count.'}</span>}
      {isSuccess && count !== undefined && (
        <span className="text-ui-fg-base">Total Products: {count}</span>
      )}
      {isSuccess && count === undefined && !isLoading && (
        <span className="text-ui-fg-muted">Product count not available.</span>
      )}
    </NodeViewWrapper>
  );
};

export default ProductsWidgetNodeView;
