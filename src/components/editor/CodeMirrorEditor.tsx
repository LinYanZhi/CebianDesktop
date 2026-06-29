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
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

// 亮色主题：覆盖编辑器内容区 + 行号区背景
const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid hsl(var(--border))' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
});

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
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(el.classList.contains('dark'));
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
        syntaxHighlighting(defaultHighlightStyle),
        cmPlaceholder(placeholder),
        updateListener,
        themeComp.of(isDark ? oneDark : lightTheme),
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
    const effective = isDark ? oneDark : lightTheme;
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
