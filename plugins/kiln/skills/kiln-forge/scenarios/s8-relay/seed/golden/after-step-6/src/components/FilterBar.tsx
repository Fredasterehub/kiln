import { motion } from 'framer-motion';

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: { opacity: 1, y: 0 },
};

interface FilterBarProps {
  tags: string[];
  activeTag: string | null;
  onTagSelect: (tag: string | null) => void;
}

function getButtonClassName(isActive: boolean): string {
  return isActive
    ? 'rounded-full bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-sky-300'
    : 'rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-200';
}

export function FilterBar({
  tags,
  activeTag,
  onTagSelect,
}: FilterBarProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <motion.div
      className="flex flex-wrap gap-2 overflow-x-auto pb-1"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.button
        type="button"
        onClick={() => {
          onTagSelect(null);
        }}
        className={getButtonClassName(activeTag === null)}
        variants={itemVariants}
      >
        All
      </motion.button>
      {tags.map((tag) => {
        const isActive = activeTag === tag;

        return (
          <motion.button
            key={tag}
            type="button"
            onClick={() => {
              onTagSelect(isActive ? null : tag);
            }}
            className={getButtonClassName(isActive)}
            variants={itemVariants}
          >
            {tag}
          </motion.button>
        );
      })}
    </motion.div>
  );
}
