import { Node, mergeAttributes, Editor, Range } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import ProductsWidgetNodeView from './ProductsWidgetNodeView';

export interface ProductsWidgetOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    productsWidget: {
      /**
       * Add a products widget node
       */
      setProductsWidget: () => ReturnType;
    };
  }
}

export const ProductsWidgetExtension = Node.create<ProductsWidgetOptions>({
  name: 'productsWidget',
  group: 'block',
  atom: true, // Treats the node as a single, indivisible unit
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-products-widget]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-products-widget': '' }), 0];
  },

  addCommands() {
    return {
      setProductsWidget: () => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
        });
      },
    };
  },

  addSlashCommands() {
    return [
      {
        label: 'Products Info',
        icon: '🛍️', // This might be used by your CommandsList component
        aliases: ['products', 'prodwidget'], // Optional: for matching
        action: ({ editor, range }: { editor: Editor; range: Range }) => {
          editor.chain().focus().deleteRange(range).setProductsWidget().run();
        },
        // shouldBeHidden: (editor: Editor) => !editor.can().setProductsWidget(), // Optional: logic to hide the command
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProductsWidgetNodeView);
  },
});

export default ProductsWidgetExtension;
