import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  // Helper to parse inline styles (bold, inline code, italic)
  const renderInline = (text: string): React.ReactNode[] => {
    // Regex splits text into tokens: `code`, **bold**, *italic*
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

    return tokens.map((token, index) => {
      if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
        const codeText = token.slice(1, -1);
        return (
          <code
            key={index}
            className="bg-slate-800/90 text-cyan-300 px-1.5 py-0.5 rounded font-mono text-[11px] border border-slate-700/60"
          >
            {codeText}
          </code>
        );
      }
      if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
        const boldText = token.slice(2, -2);
        return (
          <strong key={index} className="font-semibold text-slate-100">
            {boldText}
          </strong>
        );
      }
      if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
        const italicText = token.slice(1, -1);
        return (
          <em key={index} className="italic text-slate-300">
            {italicText}
          </em>
        );
      }
      return token;
    });
  };

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];

  const flushList = () => {
    if (currentListItems.length > 0) {
      elements.push(
        <ul key={`list_${elements.length}`} className="my-1.5 space-y-1">
          {currentListItems}
        </ul>
      );
      currentListItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Horizontal Rule: --- or ***
    if (/^---+$|^\*\*\*+$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={`hr_${i}`} className="border-t border-slate-800 my-2.5" />);
      continue;
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3
          key={`h3_${i}`}
          className="text-xs font-bold text-blue-400 mt-2.5 mb-1 uppercase tracking-wider flex items-center gap-1.5"
        >
          {renderInline(trimmed.substring(4))}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2
          key={`h2_${i}`}
          className="text-sm font-bold text-cyan-300 mt-3 mb-1.5"
        >
          {renderInline(trimmed.substring(3))}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1
          key={`h1_${i}`}
          className="text-sm font-extrabold text-slate-100 mt-3 mb-1.5 border-b border-slate-800 pb-1"
        >
          {renderInline(trimmed.substring(2))}
        </h1>
      );
      continue;
    }

    // Bullet points: * or -
    if (/^[\*\-]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[\*\-]\s+/, '');
      currentListItems.push(
        <li key={`li_${i}`} className="flex items-start gap-2 text-slate-200">
          <span className="text-blue-400 select-none mt-0.5">•</span>
          <span className="flex-1">{renderInline(itemText)}</span>
        </li>
      );
      continue;
    }

    // Empty line
    if (trimmed === '') {
      flushList();
      elements.push(<div key={`empty_${i}`} className="h-1.5" />);
      continue;
    }

    // Normal paragraph line
    flushList();
    elements.push(
      <p key={`p_${i}`} className="text-slate-200 leading-relaxed my-0.5">
        {renderInline(rawLine)}
      </p>
    );
  }

  flushList();

  return <div className={`space-y-0.5 text-xs ${className}`}>{elements}</div>;
};
