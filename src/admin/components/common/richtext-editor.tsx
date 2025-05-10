// 
import { useCallback } from 'react';
import { Toaster, toast } from '@medusajs/ui';
import './richtext-editor.css';

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
  import { Link } from 'reactjs-tiptap-editor/link'
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
    Link,
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
    SlashCommand,
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
    editorContent, 
    setEditorContent,
    isLoading = false,
    onEditorReady = undefined
  }: { 
    editorContent: string; 
    setEditorContent: (content: string) => void;
    isLoading?: boolean;
    onEditorReady?: (editor: any) => void;
  }) {
    // Create a callback ref to get access to the editor instance
    const editorCallbackRef = useCallback((editorInstance: any) => {
      if (editorInstance && onEditorReady) {
        // The editor instance has a getEditor() method that returns the actual editor
        // with access to the state, view, etc.
        const editor = editorInstance?.editor;
        if (editor) {
          onEditorReady(editor);
        }
      }
    }, [onEditorReady]);    
    
    return (
  <>
    <Toaster />
    <div className={`relative h-full ${isLoading ? 'opacity-50 cursor-wait' : ''}`}>
      <RichTextEditor 
        output='json' 
        content={editorContent} 
        onChangeContent={setEditorContent} 
        extensions={extensions} 
        //contentClass={{ height: '100%', minHeight: '500px'}} 
        disabled={isLoading}
        ref={editorCallbackRef}
        toolbar={{
          render: (_props, _toolbarItems, dom, containerDom) => (
            <div className="richtext-code-block-toolbar">
              {containerDom(dom)}
            </div>
          )
        }}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm text-gray-500">Saving changes...</div>
        </div>
      )}
    </div>      
  </>
);
  }
  
  export { DEFAULT, extensions, TextEditor };