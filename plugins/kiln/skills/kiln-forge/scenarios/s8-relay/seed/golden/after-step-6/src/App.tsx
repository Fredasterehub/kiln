import { useCallback, useEffect, useState } from 'react';
import { AddLinkForm } from './components/AddLinkForm.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { Header } from './components/Header.tsx';
import { LinkGrid } from './components/LinkGrid.tsx';
import { useLinks } from './hooks/useLinks.ts';
import { useMetadata } from './hooks/useMetadata.ts';

function App() {
  const { links, addLink, deleteLink, updateLink, updateLinkTags } = useLinks();
  const { resolveMetadata } = useMetadata();
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = Array.from(new Set(links.flatMap((link) => link.tags))).sort();
  const filteredLinks = activeTag
    ? links.filter((link) => link.tags.includes(activeTag))
    : links;

  const handleSubmit = useCallback(
    (url: string): void => {
      const id = addLink(url);

      if (!id) {
        return;
      }

      setResolvingIds((prev) => new Set(prev).add(id));
      resolveMetadata(id, url, updateLink).finally(() => {
        setResolvingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
    },
    [addLink, resolveMetadata, updateLink],
  );

  useEffect(() => {
    if (activeTag !== null && !allTags.includes(activeTag)) {
      setActiveTag(null);
    }
  }, [activeTag, allTags]);

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
        <Header />
        <AddLinkForm onSubmit={handleSubmit} />
        <FilterBar
          tags={allTags}
          activeTag={activeTag}
          onTagSelect={setActiveTag}
        />
        <LinkGrid
          links={filteredLinks}
          resolvingIds={resolvingIds}
          allTags={allTags}
          onDelete={deleteLink}
          onUpdateTags={updateLinkTags}
        />
      </main>
    </div>
  );
}

export default App;
