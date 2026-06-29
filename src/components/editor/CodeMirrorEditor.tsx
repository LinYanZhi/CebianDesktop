/**
 * CodeMirror 6 React 组件
 *
 * 提供语法高亮、行号、暗色/亮色主题、语言检测、只读模式。
 */
import { useRef, useEffect, useMemo, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';

// 亮色主题：编辑器外观
const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid hsl(var(--border))' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: '#333' },
});

// 亮色语法高亮（对标 GitHub 风格，标题不加下划线）
const lightHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold', color: '#0550AE' },
  { tag: tags.heading1, fontWeight: 'bold', color: '#0550AE' },
  { tag: tags.heading2, fontWeight: 'bold', color: '#0550AE' },
  { tag: tags.heading3, fontWeight: 'bold', color: '#0550AE' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#0969DA', textDecoration: 'underline' },
  { tag: tags.url, color: '#0969DA', textDecoration: 'underline' },
  { tag: tags.comment, color: '#6E7781', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#CF222E' },
  { tag: tags.string, color: '#0A3069' },
  { tag: tags.number, color: '#0550AE' },
  { tag: tags.bool, color: '#0550AE' },
  { tag: tags.typeName, color: '#116329' },
  { tag: tags.function(tags.variableName), color: '#8250DF' },
  { tag: tags.propertyName, color: '#116329' },
  { tag: tags.atom, color: '#0550AE' },
  { tag: tags.meta, color: '#6E7781' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono, monospace)' },
  { tag: tags.list, color: '#0550AE' },
  { tag: tags.quote, color: '#6E7781', fontStyle: 'italic' },
  { tag: tags.inserted, color: '#116329' },
  { tag: tags.deleted, color: '#CF222E' },
  { tag: tags.changed, color: '#953800' },
]);

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'markdown' | 'yaml' | 'javascript';
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  fontSize?: string;
}

function detectLanguage(filename: string): 'markdown' | 'yaml' | 'javascript' {
  if (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.jsx')) return 'javascript';
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'yaml';
  return 'markdown';
}

function getLanguageExtension(lang?: string) {
  switch (lang) {
    case 'markdown': return markdown();
    case 'yaml': return yaml();
    case 'javascript': return javascript();
    default: return markdown();
  }
}

export function CodeMirrorEditor({
  value,
  onChange,
  language: forcedLang,
  placeholder = '',
  readOnly = false,
  className = '',
  fontSize = '13px',
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const syncingRef = useRef(false);

  // 自动检测暗色/亮色主题
  // CSS: :root 为暗色(默认)，.light 为亮色，无 dark 类
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'));

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(!el.classList.contains('light'));
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  onChangeRef.current = onChange;
  valueRef.current = value;

  const themeComp = useMemo(() => new Compartment(), []);
  const readOnlyComp = useMemo(() => new Compartment(), []);
  const langComp = useMemo(() => new Compartment(), []);
  const fontSizeComp = useMemo(() => new Compartment(), []);
  const fontSizeStrRef = useRef(fontSize);
  fontSizeStrRef.current = fontSize;

  // Resolve language from filename if not forced
  const resolvedLang = forcedLang || 'markdown';

  // Create editor once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 如果已有 view 则先销毁
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !syncingRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        history(),
        lineNumbers(),
        EditorView.lineWrapping,
        cmPlaceholder(placeholder),
        updateListener,
        themeComp.of(isDark
          ? oneDark
          : [lightTheme, syntaxHighlighting(lightHighlight)]),
        readOnlyComp.of(EditorState.readOnly.of(readOnly)),
        langComp.of(getLanguageExtension(resolvedLang)),
        fontSizeComp.of(EditorView.theme({ '&': { fontSize: fontSizeStrRef.current } })),
      ],
    });

    const view = new EditorView({
      state,
      parent: container,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync theme
  useEffect(() => {
    if (!viewRef.current) return;
    const effective = isDark
      ? oneDark
      : [lightTheme, syntaxHighlighting(lightHighlight)];
    viewRef.current.dispatch({
      effects: themeComp.reconfigure(effective),
    });
  }, [isDark, themeComp]);

  // Sync readOnly
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly, readOnlyComp]);

  // Sync language
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: langComp.reconfigure(getLanguageExtension(resolvedLang)),
    });
  }, [resolvedLang, langComp]);

  // Sync fontSize
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: fontSizeComp.reconfigure(EditorView.theme({ '&': { fontSize } })),
    });
  }, [fontSize, fontSizeComp]);

  // Sync value from outside (when file changes)
  useEffect(() => {
    if (!viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    if (current !== value) {
      syncingRef.current = true;
      viewRef.current.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
      syncingRef.current = false;
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono ${className}`}
      style={{ height: '100%' }}
    />
  );
}

export { detectLanguage };
