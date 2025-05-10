/**
 * Utility class to convert TipTap editor JSON content to HTML for email sending
 * 
 * This implementation matches the styling used in the blog-post-content component
 * to ensure consistent appearance between the website and email.
 */

class TipTapToHTML {
  private options: {
    linkClass: string;
    imageClass: string;
    emailStyling: boolean;
    [key: string]: any;
  };

  constructor(options: any = {}) {
    this.options = {
      // Default options
      linkClass: 'link',
      imageClass: 'image',
      emailStyling: true, // Enable email-friendly styling by default
      ...options
    };
  }

  convert(doc: any) {
    if (!doc || !doc.content) return '';
    
    let html = '';
    for (const node of doc.content) {
      html += this.renderNode(node);
    }

    // If email styling is enabled, wrap the content in a styled div
    if (this.options.emailStyling) {
      return `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: #333; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px;">
          ${html}
        </div>
      `;
    }
    
    return html;
  }

  renderNode(node: any) {
    if (!node) return '';

    switch (node.type) {
      case 'text':
        return this.renderText(node);
      case 'paragraph':
        return this.renderParagraph(node);
      case 'heading':
        return this.renderHeading(node);
      case 'bulletList':
        return this.renderBulletList(node);
      case 'orderedList':
        return this.renderOrderedList(node);
      case 'listItem':
        return this.renderListItem(node);
      case 'codeBlock':
        return this.renderCodeBlock(node);
      case 'image':
        return this.renderImage(node);
      case 'table':
        return this.renderTable(node);
      case 'tableRow':
        return this.renderTableRow(node);
      case 'tableCell':
        return this.renderTableCell(node);
      case 'blockquote':
        return this.renderBlockquote(node);
      case 'horizontalRule':
        return this.renderHorizontalRule();
      case 'hardBreak':
        return '<br>';
      case 'doc':
        return this.renderContent(node.content);
      default:
        console.warn(`Unknown node type: ${node.type}`);
        return '';
    }
  }

  renderText(node: any) {
    let text = node.text || '';
    
    if (node.marks) {
      for (const mark of node.marks) {
        text = this.applyMark(text, mark);
      }
    }
    
    return text;
  }

  applyMark(text: string, mark: any) {
    switch (mark.type) {
      case 'bold':
        return this.options.emailStyling 
          ? `<strong style="font-weight: 600;">${text}</strong>` 
          : `<strong>${text}</strong>`;
      case 'italic':
        return this.options.emailStyling 
          ? `<em style="font-style: italic;">${text}</em>` 
          : `<em>${text}</em>`;
      case 'underline':
        return this.options.emailStyling 
          ? `<u style="text-decoration: underline;">${text}</u>` 
          : `<u>${text}</u>`;
      case 'strike':
        return this.options.emailStyling 
          ? `<s style="text-decoration: line-through;">${text}</s>` 
          : `<s>${text}</s>`;
      case 'code':
        return this.options.emailStyling 
          ? `<code style="font-family: monospace; background-color: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em;">${text}</code>` 
          : `<code>${text}</code>`;
      case 'link':
        const href = mark.attrs?.href || '';
        return this.options.emailStyling 
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #0070f3; text-decoration: none; font-weight: 500;">${text}</a>` 
          : `<a href="${href}" class="${this.options.linkClass}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      case 'textStyle':
        return this.applyTextStyle(text, mark.attrs);
      case 'highlight':
        const color = mark.attrs?.color || 'yellow';
        return `<span style="background-color: ${color};">${text}</span>`;
      default:
        console.warn(`Unknown mark type: ${mark.type}`);
        return text;
    }
  }

  applyTextStyle(text: string, attrs: any) {
    const styles: string[] = [];
    if (attrs?.color) styles.push(`color: ${attrs.color}`);
    if (attrs?.fontSize) styles.push(`font-size: ${attrs.fontSize}`);
    if (attrs?.fontFamily) styles.push(`font-family: ${attrs.fontFamily}`);
    
    return styles.length 
      ? `<span style="${styles.join('; ')}">${text}</span>`
      : text;
  }

  renderParagraph(node: any) {
    const content = this.renderContent(node.content);
    return this.options.emailStyling 
      ? `<p style="margin-bottom: 1.5em; font-size: 16px;">${content}</p>` 
      : `<p>${content}</p>`;
  }

  renderHeading(node: any) {
    const level = node.attrs?.level || 2;
    const content = this.renderContent(node.content);
    
    if (this.options.emailStyling) {
      let style = '';
      if (level === 1) {
        style = 'font-size: 2em; font-weight: 700; margin-top: 1.5em; margin-bottom: 0.8em; color: #111;';
      } else if (level === 2) {
        style = 'font-size: 1.5em; font-weight: 600; margin-top: 1.4em; margin-bottom: 0.7em; color: #222;';
      } else if (level === 3) {
        style = 'font-size: 1.25em; font-weight: 600; margin-top: 1.3em; margin-bottom: 0.6em; color: #333;';
      } else {
        style = 'font-size: 1.1em; font-weight: 600; margin-top: 1.2em; margin-bottom: 0.5em; color: #444;';
      }
      return `<h${level} style="${style}">${content}</h${level}>`;
    }
    
    return `<h${level}>${content}</h${level}>`;
  }

  renderBulletList(node: any) {
    const items = this.renderContent(node.content);
    return this.options.emailStyling 
      ? `<ul style="padding-left: 1.5em; margin-bottom: 1.5em;">${items}</ul>` 
      : `<ul>${items}</ul>`;
  }

  renderOrderedList(node: any) {
    const items = this.renderContent(node.content);
    const start = node.attrs?.start || 1;
    return this.options.emailStyling 
      ? `<ol style="padding-left: 1.5em; margin-bottom: 1.5em;" start="${start}">${items}</ol>` 
      : `<ol start="${start}">${items}</ol>`;
  }

  renderListItem(node: any) {
    const content = this.renderContent(node.content);
    return this.options.emailStyling 
      ? `<li style="margin-bottom: 0.5em;">${content}</li>` 
      : `<li>${content}</li>`;
  }

  renderCodeBlock(node: any) {
    const code = node.content?.[0]?.text || '';
    const language = node.attrs?.language || '';
    return this.options.emailStyling 
      ? `<pre style="background-color: #f5f5f5; padding: 1em; border-radius: 4px; overflow-x: auto;"><code style="font-family: monospace;" class="language-${language}">${escapeHtml(code)}</code></pre>` 
      : `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
  }

  renderImage(node: any) {
    const src = node.attrs?.src || '';
    const alt = node.attrs?.alt || '';
    const title = node.attrs?.title || '';
    const width = node.attrs?.width ? `width="${node.attrs.width}"` : '';
    const align = node.attrs?.align || 'center';
    
    if (this.options.emailStyling) {
      return `<div style="text-align: ${align}; margin: 1.5em 0;">
        <img src="${src}" alt="${alt}" title="${title}" ${width} style="max-width: 100%; height: auto; border-radius: 4px;">
      </div>`;
    }
    
    return `<div class="image-container" style="text-align: ${align}">
      <img src="${src}" alt="${alt}" title="${title}" ${width} class="${this.options.imageClass}">
    </div>`;
  }

  renderTable(node: any) {
    const rows = this.renderContent(node.content);
    return this.options.emailStyling 
      ? `<table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5em;">${rows}</table>` 
      : `<table>${rows}</table>`;
  }

  renderTableRow(node: any) {
    const cells = this.renderContent(node.content);
    return `<tr>${cells}</tr>`;
  }

  renderTableCell(node: any) {
    const content = this.renderContent(node.content);
    return this.options.emailStyling 
      ? `<td style="border: 1px solid #e0e0e0; padding: 0.5em;">${content}</td>` 
      : `<td>${content}</td>`;
  }

  renderBlockquote(node: any) {
    const content = this.renderContent(node.content);
    return this.options.emailStyling 
      ? `<blockquote style="border-left: 4px solid #e0e0e0; padding-left: 1em; margin-left: 0; margin-right: 0; font-style: italic; color: #555;">${content}</blockquote>` 
      : `<blockquote>${content}</blockquote>`;
  }

  renderHorizontalRule() {
    return this.options.emailStyling 
      ? '<hr style="border: none; height: 1px; background-color: #e0e0e0; margin: 2em 0;" />' 
      : '<hr />';
  }

  renderContent(content: any[]) {
    if (!content) return '';
    
    let html = '';
    for (const node of content) {
      html += this.renderNode(node);
    }
    return html;
  }
}

// Helper function to escape HTML
function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Converts TipTap JSON content to HTML
 * @param content - TipTap JSON content or string representation of JSON
 * @returns HTML string
 */
export function convertTipTapToHtml(content: any): string {
  try {
    // Parse content if it's a string
    const jsonContent = typeof content === 'string' 
      ? JSON.parse(content) 
      : content;
    
    console.log('TipTap JSON content:', JSON.stringify(jsonContent, null, 2));
    
    // Handle different content structures
    let docContent;
    
    // Check if content is nested inside a 'text' property
    if (jsonContent.text && jsonContent.text.type === 'doc') {
      docContent = jsonContent.text;
      console.log('Found content in text property');
    } 
    // Check if it's a direct doc object
    else if (jsonContent.type === 'doc') {
      docContent = jsonContent;
      console.log('Found direct doc content');
    }
    // If neither structure is found, try to find any property that has a doc structure
    else {
      for (const key in jsonContent) {
        if (jsonContent[key] && typeof jsonContent[key] === 'object' && jsonContent[key].type === 'doc') {
          docContent = jsonContent[key];
          console.log(`Found content in ${key} property`);
          break;
        }
      }
    }
    
    // If we couldn't find a doc structure, log an error and return empty content
    if (!docContent) {
      console.error('Could not find TipTap doc structure in content');
      console.log('Content structure:', Object.keys(jsonContent));
      return `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: #333; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px;">
          <p style="margin-bottom: 1.5em; font-size: 16px;">Unable to process blog content. Please view the full article on our website.</p>
        </div>
      `;
    }
    
    // Create a new instance of the converter with email styling enabled
    const converter = new TipTapToHTML({ emailStyling: true });
    
    // Convert the document to HTML
    const htmlContent = converter.convert(docContent);
    
    console.log('Converted HTML:', htmlContent);
    return htmlContent;
    
  } catch (error) {
    console.error('Error converting TipTap content to HTML:', error);
    
    // If parsing fails, return the original content if it's a string
    // or an empty string if it's an object
    return typeof content === 'string' ? content : '';
  }
}

// Export the class for direct usage if needed
export default TipTapToHTML;

/**
 * Processes a TipTap node and converts it to HTML
 * @param node - TipTap node
 * @returns HTML string
 */
function processNode(node: any): string {
  if (!node) return '';
  
  // Handle text nodes
  if (node.type === 'text') {
    let text = node.text || '';
    
    // Apply marks (bold, italic, etc.)
    if (node.marks && node.marks.length > 0) {
      for (const mark of node.marks) {
        text = applyMark(text, mark);
      }
    }
    
    return text;
  }
  
  // Handle paragraph nodes
  if (node.type === 'paragraph') {
    const content = node.content?.map(processNode).join('') || '';
    return `<p style="margin-bottom: 1.5em; font-size: 16px;">${content}</p>`;
  }
  
  // Handle heading nodes
  if (node.type === 'heading') {
    const level = node.attrs?.level || 1;
    const content = node.content?.map(processNode).join('') || '';
    
    // Apply different styling based on heading level
    let style = '';
    if (level === 1) {
      style = 'font-size: 2em; font-weight: 700; margin-top: 1.5em; margin-bottom: 0.8em; color: #111;';
    } else if (level === 2) {
      style = 'font-size: 1.5em; font-weight: 600; margin-top: 1.4em; margin-bottom: 0.7em; color: #222;';
    } else if (level === 3) {
      style = 'font-size: 1.25em; font-weight: 600; margin-top: 1.3em; margin-bottom: 0.6em; color: #333;';
    } else {
      style = 'font-size: 1.1em; font-weight: 600; margin-top: 1.2em; margin-bottom: 0.5em; color: #444;';
    }
    
    return `<h${level} style="${style}">${content}</h${level}>`;
  }
  
  // Handle bullet list nodes
  if (node.type === 'bulletList') {
    const items = node.content?.map(processNode).join('') || '';
    return `<ul style="padding-left: 1.5em; margin-bottom: 1.5em;">${items}</ul>`;
  }
  
  // Handle ordered list nodes
  if (node.type === 'orderedList') {
    const items = node.content?.map(processNode).join('') || '';
    return `<ol style="padding-left: 1.5em; margin-bottom: 1.5em;">${items}</ol>`;
  }
  
  // Handle list item nodes
  if (node.type === 'listItem') {
    const content = node.content?.map(processNode).join('') || '';
    return `<li style="margin-bottom: 0.5em;">${content}</li>`;
  }
  
  // Handle blockquote nodes
  if (node.type === 'blockquote') {
    const content = node.content?.map(processNode).join('') || '';
    return `<blockquote style="border-left: 4px solid #e0e0e0; padding-left: 1em; margin-left: 0; margin-right: 0; font-style: italic; color: #555;">${content}</blockquote>`;
  }
  
  // Handle image nodes
  if (node.type === 'image') {
    const src = node.attrs?.src || '';
    const alt = node.attrs?.alt || '';
    return `<img src="${src}" alt="${alt}" style="max-width: 100%; height: auto; margin: 1.5em 0; border-radius: 4px;" />`;
  }
  
  // Handle horizontal rule
  if (node.type === 'horizontalRule') {
    return '<hr style="border: none; height: 1px; background-color: #e0e0e0; margin: 2em 0;" />';
  }
  
  // Handle links
  if (node.type === 'link') {
    const href = node.attrs?.href || '';
    const content = node.content?.map(processNode).join('') || '';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #0070f3; text-decoration: none; font-weight: 500;">${content}</a>`;
  }
  
  // Handle document node (root)
  if (node.type === 'doc') {
    return node.content?.map(processNode).join('') || '';
  }
  
  // Handle other nodes with content
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(processNode).join('');
  }
  
  // Default case
  return '';
}

/**
 * Applies a mark to text
 * @param text - Text to apply mark to
 * @param mark - Mark to apply
 * @returns HTML string with mark applied
 */
function applyMark(text: string, mark: any): string {
  switch (mark.type) {
    case 'bold':
      return `<strong style="font-weight: 600;">${text}</strong>`;
    case 'italic':
      return `<em style="font-style: italic;">${text}</em>`;
    case 'underline':
      return `<u style="text-decoration: underline;">${text}</u>`;
    case 'strike':
      return `<s style="text-decoration: line-through;">${text}</s>`;
    case 'code':
      return `<code style="font-family: monospace; background-color: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em;">${text}</code>`;
    case 'link':
      const href = mark.attrs?.href || '';
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #0070f3; text-decoration: none; font-weight: 500;">${text}</a>`;
    case 'highlight':
      const color = mark.attrs?.color || 'yellow';
      return `<span style="background-color: ${color};">${text}</span>`;
    case 'textStyle':
      const styles: string[] = [];
      if (mark.attrs?.color) {
        styles.push(`color: ${mark.attrs.color}`);
      }
      if (mark.attrs?.fontSize) {
        styles.push(`font-size: ${mark.attrs.fontSize}`);
      }
      if (mark.attrs?.fontFamily) {
        styles.push(`font-family: ${mark.attrs.fontFamily}`);
      }
      return styles.length > 0 
        ? `<span style="${styles.join('; ')}">${text}</span>` 
        : text;
    default:
      return text;
  }
}
