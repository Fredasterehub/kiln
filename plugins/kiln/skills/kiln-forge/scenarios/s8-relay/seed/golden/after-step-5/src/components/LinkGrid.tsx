import { AnimatePresence, motion } from 'framer-motion';
import { LinkCard } from './LinkCard.tsx';
import type { Link } from '../lib/types.ts';

interface LinkGridProps {
  links: Link[];
  resolvingIds: Set<string>;
  allTags: string[];
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
}

export function LinkGrid({
  links,
  resolvingIds,
  allTags,
  onDelete,
  onUpdateTags,
}: LinkGridProps) {
  if (links.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500"
      >
        Paste a URL to get started
      </motion.div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {links.map((link) => (
          <LinkCard
            key={link.id}
            link={link}
            isResolving={resolvingIds.has(link.id)}
            allTags={allTags}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
