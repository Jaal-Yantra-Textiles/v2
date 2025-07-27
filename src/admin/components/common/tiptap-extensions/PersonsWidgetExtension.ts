// @ts-nocheck
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PersonsWidgetNodeView } from './PersonsWidgetNodeView';


declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    personsWidget: {
      /**
       * Add a persons widget node
       */
      setPersonsWidget: (options?: { 'data-count'?: number }) => ReturnType;
    };
  }
}

export const PersonsWidgetExtension = Node.create<any>({
  name: 'personsWidget',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      'data-count': {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="persons-widget"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'persons-widget' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PersonsWidgetNodeView);
  },

  addCommands() {
    return {
      setPersonsWidget: (options) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options,
        });
      },
    };
  },
  // We will add the slash command configuration in richtext-editor.tsx
  // similar to how ProductsWidgetExtension is handled, via renderGroupItem.
});
