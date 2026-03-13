import { useCallback, useState } from 'react';
import type { ClipboardEvent, FormEvent } from 'react';
import { normalizeUrl } from '../lib/metadata.ts';

interface AddLinkFormProps {
  onSubmit: (url: string) => void;
  disabled?: boolean;
}

export function AddLinkForm({
  onSubmit,
  disabled = false,
}: AddLinkFormProps) {
  const [value, setValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const submitValue = useCallback(
    (rawValue: string, showValidationError: boolean): void => {
      if (!normalizeUrl(rawValue)) {
        if (showValidationError) {
          setError('Enter a valid URL.');
        }
        return;
      }

      setError(null);
      onSubmit(rawValue);
      setValue('');
    },
    [onSubmit],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      submitValue(value, true);
    },
    [submitValue, value],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>): void => {
      const pastedText = event.clipboardData.getData('text');

      if (!normalizeUrl(pastedText)) {
        return;
      }

      event.preventDefault();
      submitValue(pastedText, false);
    },
    [submitValue],
  );

  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) {
              setError(null);
            }
          }}
          onPaste={handlePaste}
          placeholder="Paste a URL to save it"
          disabled={disabled}
          className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-200 focus:shadow-[0_0_0_4px_rgba(56,189,248,0.15)] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Link URL"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-sky-300"
        >
          Add Link
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-600">{error}</p>
      ) : null}
    </form>
  );
}
