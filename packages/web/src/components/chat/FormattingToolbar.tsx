import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './FormattingToolbar.module.css';

interface FormattingToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (newText: string) => void;
}

interface FormatAction {
  label: string;
  titleKey:
    | 'formattingToolbar.bold'
    | 'formattingToolbar.italic'
    | 'formattingToolbar.strikethrough'
    | 'formattingToolbar.code'
    | 'formattingToolbar.blockquote';
  prefix: string;
  suffix: string;
  className?: string;
  blockquote?: boolean;
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    label: 'B',
    titleKey: 'formattingToolbar.bold',
    prefix: '**',
    suffix: '**',
    className: styles.bold,
  },
  {
    label: 'I',
    titleKey: 'formattingToolbar.italic',
    prefix: '*',
    suffix: '*',
    className: styles.italic,
  },
  {
    label: 'S',
    titleKey: 'formattingToolbar.strikethrough',
    prefix: '~~',
    suffix: '~~',
    className: styles.strike,
  },
  {
    label: '<>',
    titleKey: 'formattingToolbar.code',
    prefix: '`',
    suffix: '`',
    className: styles.code,
  },
  {
    label: '\u201C',
    titleKey: 'formattingToolbar.blockquote',
    prefix: '> ',
    suffix: '',
    blockquote: true,
  },
];

function applyBlockquote(
  text: string,
  start: number,
  end: number,
): { newText: string; cursorPos: number } {
  // Find the start of the current line
  let lineStart = start;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') {
    lineStart--;
  }

  if (start === end) {
    // No selection — prepend `> ` to current line
    const newText = text.slice(0, lineStart) + '> ' + text.slice(lineStart);
    return { newText, cursorPos: start + 2 };
  }

  // Selection — prepend `> ` to each selected line
  const before = text.slice(0, lineStart);
  const selected = text.slice(lineStart, end);
  const after = text.slice(end);
  const quoted = selected
    .split('\n')
    .map((line) => '> ' + line)
    .join('\n');
  const newText = before + quoted + after;
  return { newText, cursorPos: before.length + quoted.length };
}

function applyWrap(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): { newText: string; cursorPos: number } {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const newText = before + prefix + selected + suffix + after;
  // If no selection, place cursor between markers; otherwise place after closing marker
  const cursorPos =
    start === end ? start + prefix.length : start + prefix.length + selected.length + suffix.length;
  return { newText, cursorPos };
}

export function FormattingToolbar({ textareaRef, onTextChange }: FormattingToolbarProps) {
  const { t } = useTranslation('chat');

  function handleFormat(action: FormatAction) {
    const ta = textareaRef.current;
    if (!ta) return;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;

    const { newText, cursorPos } = action.blockquote
      ? applyBlockquote(text, start, end)
      : applyWrap(text, start, end, action.prefix, action.suffix);

    onTextChange(newText);

    // Restore focus and cursor position after React re-render
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  }

  return (
    <div className={styles.toolbar}>
      {FORMAT_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          className={`${styles.btn}${action.className ? ` ${action.className}` : ''}`}
          onClick={() => {
            handleFormat(action);
          }}
          tabIndex={-1}
          title={t(action.titleKey)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
