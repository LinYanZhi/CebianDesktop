/**
 * CodeMirror 6 React 组件
 *
 * 提供语法高亮、行号、暗色/亮色主题、语言检测、只读模式。
 */
import { useRef, useEffect, useMemo } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'markdown' | 'yaml' | 'javascript';
  isDark?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
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
  isDark = true,
  placeholder = '',
  readOnly = false,
  className = '',
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  onChangeRef.current = onChange;
  valueRef.current = value;

  const themeComp = useMemo(() => new Compartment(), []);
  const readOnlyComp = useMemo(() => new Compartment(), []);
  const langComp = useMemo(() => new Compartment(), []);

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
      if (update.docChanged) {
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
        themeComp.of(isDark ? oneDark : []),
        readOnlyComp.of(EditorState.readOnly.of(readOnly)),
        langComp.of(getLanguageExtension(resolvedLang)),
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
    viewRef.current.dispatch({
      effects: themeComp.reconfigure(isDark ? oneDark : []),
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

  // Sync value from outside (when file changes)
  useEffect(() => {
    if (!viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    if (current !== value) {
      viewRef.current.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-sm ${className}`}
      style={{ height: '100%' }}
    />
  );
}

export { detectLanguage };
