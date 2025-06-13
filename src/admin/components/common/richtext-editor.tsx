// 
import { useCallback, useRef, useEffect } from 'react';
import { Toaster, toast } from '@medusajs/ui';
import './richtext-editor.css';
// import { CustomLink } from './custom-link-extension'; // Removed
import { Editor, Range } from '@tiptap/core';

import 'prism-code-editor-lightweight/layout.css'; 
import 'prism-code-editor-lightweight/themes/github-dark.css'; 

  import { Bold } from 'reactjs-tiptap-editor/bold'
  import { History } from 'reactjs-tiptap-editor/history';
  import { SearchAndReplace } from 'reactjs-tiptap-editor/searchandreplace'
  import { TableOfContents } from 'reactjs-tiptap-editor/tableofcontent'
  import { FormatPainter } from 'reactjs-tiptap-editor/formatpainter'
  import { Clear } from  'reactjs-tiptap-editor/clear'
  import { FontFamily } from 'reactjs-tiptap-editor/fontfamily'
  import { FontSize } from 'reactjs-tiptap-editor/fontsize'
  import { Italic } from 'reactjs-tiptap-editor/italic'
  import { TextUnderline } from 'reactjs-tiptap-editor/textunderline';
  import { Strike } from 'reactjs-tiptap-editor/strike'
  import { MoreMark } from 'reactjs-tiptap-editor/moremark'
  import { Katex } from 'reactjs-tiptap-editor/katex'
  import { Emoji } from 'reactjs-tiptap-editor/emoji'
  import { Color } from 'reactjs-tiptap-editor/color'
  import { Highlight } from 'reactjs-tiptap-editor/highlight'
  import { BulletList } from 'reactjs-tiptap-editor/bulletlist'
  import { OrderedList } from 'reactjs-tiptap-editor/orderedlist'
  import { TextAlign } from 'reactjs-tiptap-editor/textalign'
  import { Indent } from 'reactjs-tiptap-editor/indent'
  import { LineHeight } from 'reactjs-tiptap-editor/lineheight'
  import { TaskList } from 'reactjs-tiptap-editor/tasklist'
  import { Link } from 'reactjs-tiptap-editor/link';

  import { Image } from 'reactjs-tiptap-editor/image'
  import { Video } from 'reactjs-tiptap-editor/video'
  import { ImageGif } from 'reactjs-tiptap-editor/imagegif'
  import { SlashCommand } from 'reactjs-tiptap-editor/slashcommand'
  import { HorizontalRule } from 'reactjs-tiptap-editor/horizontalrule'
  import { Code } from 'reactjs-tiptap-editor/code'
  import { CodeBlock } from 'reactjs-tiptap-editor/codeblock'
  import { ColumnActionButton } from 'reactjs-tiptap-editor/multicolumn'
  import { ImportWord } from 'reactjs-tiptap-editor/importword'
  import { ExportWord } from 'reactjs-tiptap-editor/exportword'
  import { Mention } from 'reactjs-tiptap-editor/mention'
  import { Mermaid } from 'reactjs-tiptap-editor/mermaid'
  import { Twitter } from 'reactjs-tiptap-editor/twitter'
  import { Table } from 'reactjs-tiptap-editor/table'
  import { Iframe } from 'reactjs-tiptap-editor/iframe'
  import { ExportPdf } from 'reactjs-tiptap-editor/exportpdf'
  import RichTextEditor from 'reactjs-tiptap-editor';
  import { BaseKit } from 'reactjs-tiptap-editor';
  import 'reactjs-tiptap-editor/style.css';
  import { Blockquote } from 'reactjs-tiptap-editor/blockquote';
  import { Drawer } from 'reactjs-tiptap-editor/drawer'; 
  import 'easydrawer/styles.css'; 
  import 'katex/dist/katex.min.css';
  import 'react-image-crop/dist/ReactCrop.css';
  import { sdk } from '../../lib/config';
  import { Attachment } from 'reactjs-tiptap-editor/attachment';
  import { TextDirection } from 'reactjs-tiptap-editor/textdirection';  
  import { Heading as TextHeading } from 'reactjs-tiptap-editor/heading';
  import { ProductsWidgetExtension } from './tiptap-extensions/ProductsWidgetExtension';
  import { PersonsWidgetExtension } from './tiptap-extensions/PersonsWidgetExtension';


  function convertBase64ToBlob(base64: string) {
    const arr = base64.split(',')
    const mime = arr[0].match(/:(.*?);/)![1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }
  
  const extensions = [
    BaseKit.configure({
      multiColumn: true,
      placeholder: {
        showOnlyCurrent: true,
      },
      characterCount: {
        limit: 50_000,
      },
    }),
    History,
    SearchAndReplace,
    TextDirection,
    TableOfContents,
    FormatPainter.configure({ spacer: true }),
    Clear,
    FontFamily,
    TextHeading.configure({ spacer: true }),
    FontSize,
    Bold,
    Italic,
    TextUnderline,
    Strike,
    MoreMark,
    Katex,
    Emoji,
    Color.configure({ spacer: true }),
    Highlight,
    BulletList,
    OrderedList,
    TextAlign.configure({ types: ['heading', 'paragraph'], spacer: true }),
    Indent,
    LineHeight,
    TaskList.configure({
      spacer: true,
      taskItem: {
        nested: true,
      },
    }),
    Link.configure({
      openOnClick: true,
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
    Image.configure({
  upload: async (file: File) => {
    if (!file) return '';
    // Show loading toast
    const toastId = toast.loading('Uploading image...', {
      description: 'Please wait while your image is being uploaded.',
      duration: Infinity,
    });
    try {
      // Use the SDK directly to upload the file
      const result = await sdk.admin.upload.create({
        files: [file]
      });
      // Dismiss loading toast
      toast.dismiss(toastId);
      // Return the URL of the uploaded file
      if (result.files && result.files.length > 0) {
        toast.success('Image uploaded!', { duration: 2000 });
        return result.files[0].url;
      }
      toast.error('Upload failed', { duration: 3000 });
      return '';
    } catch (error) {
      toast.dismiss(toastId);
      toast.error('Error uploading image', { description: (error as Error)?.message || '', duration: 4000 });
      console.error('Error uploading image:', error);
      return '';
    }
  },
}),
    PersonsWidgetExtension, // Added PersonsWidgetExtension
    Video.configure({
      upload: async (file: File) => {
        if (!file) return '';
        
        try {
          // Use the SDK directly to upload the file
          const result = await sdk.admin.upload.create({
            files: [file]
          });
          
          // Return the URL of the uploaded file
          if (result.files && result.files.length > 0) {
            return result.files[0].url;
          }
          return '';
        } catch (error) {
          console.error('Error uploading video:', error);
          return '';
        }
      },
    }),
    ImageGif.configure({
      GIPHY_API_KEY: import.meta.env.VITE_GIPHY_API_KEY
    }),
    Blockquote.configure({ spacer: true }),
    SlashCommand.configure({
      renderGroupItem: (extension: any, groups: any[]) => {
        if (extension && extension.name === 'productsWidget') {
          const productsWidgetCommand = {
            label: 'Products Info',
            icon: '🛍️',
            aliases: ['products', 'prodwidget'],
            action: ({ editor, range }: { editor: Editor; range: Range }) => {
              editor.chain().focus().deleteRange(range).setProductsWidget().run();
            },
          };
          let customGroup = groups.find(g => g.title === 'Custom Commands');
          if (!customGroup) {
            customGroup = { title: 'Custom Commands', commands: [] };
            groups.push(customGroup);
          }
          if (!customGroup.commands.some((cmd: any) => cmd.label === productsWidgetCommand.label)) {
            customGroup.commands.push(productsWidgetCommand);
          }
        } else if (extension && extension.name === 'personsWidget') {
          const personsWidgetCommand = {
            label: 'Persons Info',
            icon: '👥',
            aliases: ['persons', 'peoplewidget'],
            action: ({ editor, range }: { editor: Editor; range: Range }) => {
              editor.chain().focus().deleteRange(range).setPersonsWidget().run();
            },
          };
          let customGroup = groups.find(g => g.title === 'Custom Commands');
          if (!customGroup) {
            customGroup = { title: 'Custom Commands', commands: [] };
            groups.push(customGroup);
          }
          if (!customGroup.commands.some((cmd: any) => cmd.label === personsWidgetCommand.label)) {
            customGroup.commands.push(personsWidgetCommand);
          }
        }
        // Note: No 'else' block that re-adds productsWidgetCommand, as the duplicated code is now removed.
      },
    }),
    HorizontalRule,
    Code.configure({
      toolbar: false,
    }),
    CodeBlock.configure({ defaultTheme: 'dracula' }),
    ColumnActionButton,
    Table,
    Iframe,
    ExportPdf.configure({ spacer: true }),
    ImportWord.configure({
      upload: (files: File[]) => {
        const f = files.map(file => ({
          src: URL.createObjectURL(file),
          alt: file.name,
        }))
        return Promise.resolve(f)
      },
    }),
    ExportWord,
    // Excalidraw,
    Mention,
    Attachment.configure({
      upload: (file: any) => {
        // fake upload return base 64
        const reader = new FileReader()
        reader.readAsDataURL(file)
  
        return new Promise((resolve) => {
          setTimeout(() => {
            const blob = convertBase64ToBlob(reader.result as string)
            resolve(URL.createObjectURL(blob))
          }, 300)
        })
      },
    }),
    Mermaid.configure({
      upload: (file: any) => {
        // fake upload return base 64
        const reader = new FileReader()
        reader.readAsDataURL(file)
  
        return new Promise((resolve) => {
          setTimeout(() => {
            const blob = convertBase64ToBlob(reader.result as string)
            resolve(URL.createObjectURL(blob))
          }, 300)
        })
      },
    }),
    Twitter,
    ProductsWidgetExtension,
    Drawer.configure({
      upload: async (file: any) => {
        if (!file) return '';
        
        try {
          // Use the SDK directly to upload the file
          const result = await sdk.admin.upload.create({
            files: [file]
          });
          
          // Return the URL of the uploaded file
          if (result.files && result.files.length > 0) {
            return result.files[0].url;
          }
          return '';
        } catch (error) {
          console.error('Error uploading attachment:', error);
          return '';
        }
      },
    }),
  ];

  const DEFAULT = '';

  function TextEditor({
    editorContent: initialEditorContent,
    setEditorContent: onSetEditorContent,
    isLoading: editorIsLoading = false,
    onEditorReady: onEditorReadyProp,
    debounceTime = 300,
  }: {
    editorContent: string;
    setEditorContent: (content: string) => void;
    isLoading?: boolean;
    onEditorReady?: (editor: Editor | null) => void;
    debounceTime?: number;
  }) {
    const debounceTimeoutRef = useRef<NodeJS.Timeout>();
    // const [activeEditor, setActiveEditor] = useState<Editor | null>(null); // No longer needed

    // const _onEditorReady = useCallback((editor: Editor | null) => { // No longer needed
    //   // setActiveEditor(editor); // No longer needed
    //   if (onEditorReadyProp) {
    //     onEditorReadyProp(editor);
    //   }
    // }, [onEditorReadyProp]);

    const editorCallbackRef = useCallback((editorInstance: any) => {
      const editor = editorInstance?.editor as Editor | null;
      if (onEditorReadyProp && editor) { // Directly call onEditorReadyProp if available
        onEditorReadyProp(editor);
      } else if (onEditorReadyProp) {
        onEditorReadyProp(null); // Or pass null if editor is null
      }
    }, [onEditorReadyProp]);
    // Note: If _onEditorReady was doing more than just calling onEditorReadyProp and setting activeEditor,
    // that logic might need to be preserved or moved. For now, simplifying based on current use.
    
    // Handle content changes with debouncing
    const handleContentChange = useCallback((content: string) => {
      // Clear any existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      // Set a new timeout
      debounceTimeoutRef.current = setTimeout(() => {
        onSetEditorContent(content);
      }, debounceTime);
    }, [onSetEditorContent, debounceTime]);
    
    // Clean up the timeout when component unmounts
    useEffect(() => {
      return () => {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }, []);
    
    return (
  <>
    <Toaster />
    <div className="relative h-full w-full overflow-y-auto">
      <div className={`${editorIsLoading ? 'opacity-50 cursor-wait' : ''} relative`}> {/* Added relative for BubbleMenu positioning context if not appending to body */}
      <RichTextEditor 
        output='json' 
        content={initialEditorContent} 
        onChangeContent={handleContentChange} 
        extensions={extensions} 
        //contentClass={{ height: '100%', minHeight: '500px'}} 
        disabled={editorIsLoading}
        ref={editorCallbackRef}
        toolbar={{
          render: (_props, _toolbarItems, dom, containerDom) => (
            <div className="richtext-code-block-toolbar">
              {containerDom(dom)}
            </div>
          )
        }}
      />
      {editorIsLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm text-gray-500">Saving changes...</div>
        </div>
      )}
      </div>
    </div>
  </>
);
  }

export { DEFAULT, extensions, TextEditor };