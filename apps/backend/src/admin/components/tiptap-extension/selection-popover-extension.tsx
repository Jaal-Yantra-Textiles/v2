import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'

// Extend Tiptap's Commands interface
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    selectionPopover: {
      showSelectionPopover: (coords?: { x: number; y: number }) => ReturnType
      hideSelectionPopover: () => ReturnType
      isSelectionPopoverVisible: () => ReturnType
    }
  }
}

export interface SelectionPopoverOptions {
  /**
   * Minimum selection length to show popover
   * @default 1
   */
  minSelectionLength: number
  
  /**
   * Delay before showing popover (in ms)
   * @default 250
   */
  showDelay: number
  
  /**
   * Callback when selection changes
   */
  onSelectionChange?: (selection: { from: number; to: number; text: string; isEmpty: boolean }) => void
  
  /**
   * Callback when popover should be shown
   */
  onShowPopover?: (selection: { from: number; to: number; text: string }, coords: { x: number; y: number }) => void
  
  /**
   * Callback when popover should be hidden
   */
  onHidePopover?: () => void
}

export interface SelectionPopoverStorage {
  isPopoverVisible: boolean
  currentSelection: { from: number; to: number; text: string } | null
  popoverCoords: { x: number; y: number } | null
}

const SelectionPopoverPluginKey = new PluginKey('selectionPopover')

// Helper functions outside the extension
function calculatePopoverPosition(editor: any, event?: MouseEvent): { x: number; y: number } | null {
  const { selection } = editor.state
  
  if (selection.empty) {
    return null
  }
  
  // Try to use mouse event coordinates first
  if (event) {
    return {
      x: event.clientX,
      y: event.clientY - 10, // Offset slightly above cursor
    }
  }
  
  // Fallback to selection coordinates
  try {
    const { view } = editor
    const { from, to } = selection
    
    // Get DOM coordinates of selection
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    
    // Calculate center position
    const x = (start.left + end.right) / 2
    const y = start.top - 10 // Position above selection
    
    return { x, y }
  } catch (error) {
    console.warn('Failed to calculate popover position:', error)
    return null
  }
}

function shouldSkipPopover(editor: any, text: string): boolean {
  // Skip if text is only whitespace
  if (!text.trim()) {
    return true
  }
  
  // Skip if already in a link
  if (editor.isActive('link')) {
    return true
  }
  
  // Skip if in code block or code mark
  if (editor.isActive('codeBlock') || editor.isActive('code')) {
    return true
  }
  
  return false
}

function handleSelectionChange(extension: any, event?: MouseEvent) {
  const { editor } = extension
  const { selection } = editor.state
  const pluginState = SelectionPopoverPluginKey.getState(editor.state)
  
  // Clear any existing timeout
  if (pluginState?.selectionTimeout) {
    clearTimeout(pluginState.selectionTimeout)
    pluginState.selectionTimeout = null
  }
  
  // Always call selection change callback
  if (extension.options.onSelectionChange) {
    const text = selection.empty ? '' : editor.state.doc.textBetween(selection.from, selection.to)
    extension.options.onSelectionChange({
      from: selection.from,
      to: selection.to,
      text,
      isEmpty: selection.empty,
    })
  }
  
  // If selection is empty, hide popover
  if (selection.empty) {
    hidePopover(extension)
    return
  }
  
  const text = editor.state.doc.textBetween(selection.from, selection.to)
  
  // Check if we should skip showing popover
  if (text.length < extension.options.minSelectionLength || shouldSkipPopover(editor, text)) {
    hidePopover(extension)
    return
  }
  
  // Set timeout to show popover after delay
  if (pluginState) {
    pluginState.selectionTimeout = setTimeout(() => {
      const coords = calculatePopoverPosition(editor, event)
      if (!coords) {
        return
      }
      
      const selectionData = {
        from: selection.from,
        to: selection.to,
        text,
      }
      
      // Update storage
      extension.storage.isPopoverVisible = true
      extension.storage.currentSelection = selectionData
      extension.storage.popoverCoords = coords
      
      // Call show popover callback
      if (extension.options.onShowPopover) {
        extension.options.onShowPopover(selectionData, coords)
      }
    }, extension.options.showDelay)
  }
}

function hidePopover(extension: any) {
  extension.storage.isPopoverVisible = false
  extension.storage.currentSelection = null
  extension.storage.popoverCoords = null
  
  if (extension.options.onHidePopover) {
    extension.options.onHidePopover()
  }
}

export const SelectionPopover = Extension.create<SelectionPopoverOptions, SelectionPopoverStorage>({
  name: 'selectionPopover',

  addOptions() {
    return {
      minSelectionLength: 1,
      showDelay: 250,
      onSelectionChange: undefined,
      onShowPopover: undefined,
      onHidePopover: undefined,
    }
  },

  addStorage() {
    return {
      isPopoverVisible: false,
      currentSelection: null,
      popoverCoords: null,
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    
    return [
      new Plugin({
        key: SelectionPopoverPluginKey,
        
        state: {
          init() {
            return {
              selectionTimeout: null as NodeJS.Timeout | null,
            }
          },
          
          apply(_tr: any, pluginState: any) {
            return pluginState
          },
        },
        
        props: {
          handleDOMEvents: {
            mouseup: (view: EditorView, event: MouseEvent) => {
              const pluginState = SelectionPopoverPluginKey.getState(view.state)
              
              // Clear existing timeout
              if (pluginState?.selectionTimeout) {
                clearTimeout(pluginState.selectionTimeout)
                pluginState.selectionTimeout = null
              }
              
              // Handle selection after a short delay
              setTimeout(() => {
                handleSelectionChange(extension, event)
              }, 10)
              
              return false
            },
            
            keyup: (view: EditorView, _event: KeyboardEvent) => {
              const pluginState = SelectionPopoverPluginKey.getState(view.state)
              
              // Clear existing timeout
              if (pluginState?.selectionTimeout) {
                clearTimeout(pluginState.selectionTimeout)
                pluginState.selectionTimeout = null
              }
              
              // Handle selection after a short delay
              setTimeout(() => {
                handleSelectionChange(extension)
              }, 10)
              
              return false
            },
          },
        },
        
        view: () => ({
          destroy: () => {
            const pluginState = SelectionPopoverPluginKey.getState(extension.editor.state)
            if (pluginState?.selectionTimeout) {
              clearTimeout(pluginState.selectionTimeout)
            }
          },
        }),
      }),
    ]
  },

  addCommands() {
    return {
      showSelectionPopover: (coords?: { x: number; y: number }) => ({ state }: any) => {
        const { selection } = state
        
        if (selection.empty) {
          return false
        }
        
        const text = state.doc.textBetween(selection.from, selection.to)
        const selectionData = {
          from: selection.from,
          to: selection.to,
          text,
        }
        
        // Calculate coordinates if not provided
        let popoverCoords = coords
        if (!popoverCoords) {
          popoverCoords = calculatePopoverPosition(this.editor) || undefined
        }
        
        if (!popoverCoords) {
          return false
        }
        
        // Update storage
        this.storage.isPopoverVisible = true
        this.storage.currentSelection = selectionData
        this.storage.popoverCoords = popoverCoords
        
        // Call show popover callback
        if (this.options.onShowPopover) {
          this.options.onShowPopover(selectionData, popoverCoords)
        }
        
        return true
      },
      
      hideSelectionPopover: () => (_props: any) => {
        this.storage.isPopoverVisible = false
        this.storage.currentSelection = null
        this.storage.popoverCoords = null
        
        if (this.options.onHidePopover) {
          this.options.onHidePopover()
        }
        
        return true
      },
      
      isSelectionPopoverVisible: () => (_props: any) => {
        return this.storage.isPopoverVisible
      },
    }
  },
})

export default SelectionPopover
