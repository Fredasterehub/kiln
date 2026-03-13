import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SPRING } from '../lib/motion.ts';

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onTagsChange: (tags: string[]) => void;
}

function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim();
}

export function TagEditor({ tags, allTags, onTagsChange }: TagEditorProps) {
  const [inputVisible, setInputVisible] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState<string>('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputVisible) {
      inputRef.current?.focus();
    }
  }, [inputVisible]);

  useEffect(() => {
    if (!inputVisible) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setInputVisible(false);
        setInputValue('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [inputVisible]);

  const addTag = (rawTag: string): void => {
    const nextTag = normalizeTag(rawTag);

    if (!nextTag || tags.includes(nextTag)) {
      return;
    }

    onTagsChange([...tags, nextTag]);
    setInputVisible(false);
    setInputValue('');
  };

  const suggestions = allTags.filter((tag) => {
    if (tags.includes(tag)) {
      return false;
    }

    return tag.includes(inputValue.toLowerCase().trim());
  });

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTag(inputValue);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setInputVisible(false);
      setInputValue('');
    }
  };

  const handleSuggestionMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
    tag: string,
  ): void => {
    event.preventDefault();
    addTag(tag);
  };

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-1.5 pt-2">
      <AnimatePresence>
        {tags.map((tag) => (
          <motion.span
            key={tag}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={SPRING}
            className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => {
                onTagsChange(tags.filter((currentTag) => currentTag !== tag));
              }}
              className="rounded-full text-sky-700 transition hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-200"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </motion.span>
        ))}
      </AnimatePresence>

      {inputVisible ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Add tag"
            className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 transition focus:outline-none focus:ring-2 focus:ring-sky-200"
            aria-label="Add tag"
          />
          {suggestions.length > 0 ? (
            <div className="absolute top-full left-0 z-10 mt-1 min-w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(event) => {
                    handleSuggestionMouseDown(event, tag);
                  }}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-200"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setInputVisible(true);
          }}
          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
          aria-label="Add tag"
        >
          +
        </button>
      )}
    </div>
  );
}
