import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  // Helper to parse inline styles (bold, inline code, italic)
  const renderInline = (text: string): React.ReactNode[] => {
    // Regex splits text into tokens: `code`, **bold**, __bold__, *italic*, _italic_
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g);

    return tokens.map((token, index) => {
      if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
        const codeText = token.slice(1, -1);
        const hexMatch = codeText.match(/^\(?#([0-9a-fA-F]{6})\)?$/);
        if (hexMatch) {
          const hex = `#${hexMatch[1]}`;
          return (
            <span
              key={index}
              className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 align-middle my-0.5"
              title={hex}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: hex, boxShadow: `0 0 6px ${hex}aa` }}
              />
            </span>
          );
        }
        return (
          <code
            key={index}
            className="bg-slate-800/90 text-cyan-300 px-1.5 py-0.5 rounded font-mono text-[11px] border border-slate-700/60"
          >
            {codeText}
          </code>
        );
      }
      if ((token.startsWith('**') && token.endsWith('**') && token.length >= 4) ||
          (token.startsWith('__') && token.endsWith('__') && token.length >= 4)) {
        const boldText = token.slice(2, -2);
        return (
          <strong key={index} className="font-semibold text-slate-100">
            {boldText}
          </strong>
        );
      }
      if ((token.startsWith('*') && token.endsWith('*') && token.length >= 2) ||
          (token.startsWith('_') && token.endsWith('_') && token.length >= 2)) {
        const italicText = token.slice(1, -1);
        return (
          <em key={index} className="italic text-slate-300">
            {italicText}
          </em>
        );
      }
      if (typeof token === 'string' && /\(?#[0-9a-fA-F]{6}\)?/.test(token)) {
        const parts = token.split(/(\(?#[0-9a-fA-F]{6}\)?)/g);
        return (
          <React.Fragment key={index}>
            {parts.map((part, pIdx) => {
              const hexMatch = part.match(/^\(?#([0-9a-fA-F]{6})\)?$/);
              if (hexMatch) {
                const hex = `#${hexMatch[1]}`;
                return (
                  <span
                    key={`${index}_${pIdx}`}
                    className="inline-flex items-center gap-1.5 px-1 py-0.5 rounded bg-slate-800/60 border border-slate-700/40 align-middle mx-1"
                    title={hex}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: hex, boxShadow: `0 0 6px ${hex}aa` }}
                    />
                  </span>
                );
              }
              return part;
            })}
          </React.Fragment>
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

    // Warning Callout Box: ⚠️ or > ⚠️
    if (trimmed.startsWith('⚠️') || trimmed.startsWith('> ⚠️')) {
      flushList();
      const warnText = trimmed.replace(/^>\s*/, '').replace(/^⚠️\s*/, '').trim();
      elements.push(
        <div
          key={`warn_${i}`}
          className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-2 text-amber-300 my-1.5 flex items-start gap-2 shadow-sm"
        >
          <span className="text-amber-400 shrink-0 select-none text-xs mt-0.5">⚠️</span>
          <span className="flex-1 leading-relaxed text-xs">{renderInline(warnText)}</span>
        </div>
      );
      continue;
    }

    // Horizontal Rule: --- or ***
    if (/^---+$|^\*\*\*+$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={`hr_${i}`} className="border-t border-slate-800 my-2.5" />);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList();
      const quoteText = trimmed.substring(2).trim();
      elements.push(
        <blockquote
          key={`quote_${i}`}
          className="border-l-2 border-slate-600 pl-2.5 my-1.5 text-slate-300 italic text-xs"
        >
          {renderInline(quoteText)}
        </blockquote>
      );
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
          <span className="flex-1 leading-relaxed">{renderInline(itemText)}</span>
        </li>
      );
      continue;
    }

    // Numbered list: 1. , 2. 
    if (/^\d+\.\s+/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        currentListItems.push(
          <li key={`li_num_${i}`} className="flex items-start gap-2 text-slate-200">
            <span className="text-cyan-400 font-mono text-[11px] select-none shrink-0">{numMatch[1]}.</span>
            <span className="flex-1 leading-relaxed">{renderInline(numMatch[2])}</span>
          </li>
        );
        continue;
      }
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
