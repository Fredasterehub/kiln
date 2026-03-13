import type { MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { TagEditor } from './TagEditor.tsx';
import type { Link } from '../lib/types.ts';
import { SPRING } from '../lib/motion.ts';

interface LinkCardProps {
  link: Link;
  isResolving: boolean;
  allTags: string[];
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
}

export function LinkCard({
  link,
  isResolving,
  allTags,
  onDelete,
  onUpdateTags,
}: LinkCardProps) {
  const handleDelete = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    onDelete(link.id);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      whileHover={{ y: -2 }}
      transition={SPRING}
      className="group relative rounded-2xl border border-slate-200 bg-white p-5 pr-14 shadow-sm hover:border-sky-300 hover:shadow-md">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <div className="flex items-start gap-3">
          <img
            src={link.favicon}
            alt=""
            width={20}
            height={20}
            className="mt-0.5 h-5 w-5 shrink-0 rounded-sm"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
          <div className="min-w-0 flex-1">
            <motion.h2
              animate={isResolving ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
              transition={isResolving ? { repeat: Infinity, duration: 1.5 } : undefined}
              className="truncate text-sm font-semibold text-slate-900"
            >
              {link.title}
            </motion.h2>
            <p className="mt-2 truncate text-sm text-slate-500">{link.url}</p>
          </div>
        </div>
      </a>
      <TagEditor
        tags={link.tags}
        allTags={allTags}
        onTagsChange={(newTags) => {
          onUpdateTags(link.id, newTags);
        }}
      />
      <button
        type="button"
        onClick={handleDelete}
        className="absolute top-3 right-3 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-200"
        aria-label={`Delete ${link.title}`}
      >
        Delete
      </button>
    </motion.div>
  );
}
