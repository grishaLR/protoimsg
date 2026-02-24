import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CategoryCombobox.module.css';

interface CategoryComboboxProps {
  categories: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export function CategoryCombobox({
  categories,
  value,
  onChange,
  placeholder,
}: CategoryComboboxProps) {
  const { t } = useTranslation('rooms');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const normalized = value.toLowerCase().trim();
  const filtered = normalized
    ? categories.filter((c) => c.toLowerCase().includes(normalized))
    : categories;
  const exactMatch = categories.some((c) => c.toLowerCase() === normalized);
  const showCreate = normalized.length > 0 && !exactMatch;
  const itemCount = filtered.length + (showCreate ? 1 : 0);

  const select = useCallback(
    (val: string) => {
      onChange(val.toLowerCase().trim());
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      setActiveIndex(0);
      e.preventDefault();
      return;
    }

    if (!open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % itemCount);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + itemCount) % itemCount);
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          const cat = filtered[activeIndex];
          if (cat) select(cat);
        } else if (showCreate && activeIndex === filtered.length) {
          select(normalized);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  }

  const activeDescendant =
    open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        className={styles.input}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toLowerCase());
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (categories.length > 0 || value.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        autoComplete="off"
      />
      {open && itemCount > 0 && (
        <ul className={styles.dropdown} ref={listRef} role="listbox" id={listboxId}>
          {filtered.map((cat, i) => (
            <li
              key={cat}
              id={`${listboxId}-option-${i}`}
              className={`${styles.item} ${i === activeIndex ? styles.active : ''}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                select(cat);
              }}
              onMouseEnter={() => {
                setActiveIndex(i);
              }}
            >
              {cat}
            </li>
          ))}
          {showCreate && (
            <li
              id={`${listboxId}-option-${filtered.length}`}
              className={`${styles.item} ${styles.createItem} ${filtered.length === activeIndex ? styles.active : ''}`}
              role="option"
              aria-selected={filtered.length === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                select(normalized);
              }}
              onMouseEnter={() => {
                setActiveIndex(filtered.length);
              }}
            >
              {t('createRoom.categoryCreate', { value: normalized })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
