import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import { MdOpenInNew, MdDownload, MdCheckCircleOutline, MdErrorOutline } from 'react-icons/md';
import { openUrl } from '@tauri-apps/plugin-opener';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { eventDispatcher } from '@/utils/event';
import { evictProvider } from '@/services/dictionaries/registry';
import { queueDictionaryBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import { BoxedList, Tips } from './primitives';
import SubPageHeader from './SubPageHeader';
import type { SelectedFile } from '@/hooks/useFileSelector';

const isTauri = isTauriAppPlatform();

// ─────────────────────────────────────────────────────────────
// Types & Catalog
// ─────────────────────────────────────────────────────────────

interface DictionaryEntry {
  id: string;
  name: string;
  description: string;
  format: 'StarDict' | 'MDict' | 'Slob' | 'DICT';
  size?: string;
  source: string;
  /** Clicking "Open in Browser" opens this. */
  homepageUrl: string;
  /** If set, "Open in Browser" redirects here (more specific download page). */
  downloadPageUrl?: string;
  /**
   * If set, enables the "In-App Download" button.
   * Must be a direct URL to a .zip archive containing only dictionary files
   * (no nested directories). The app will fetch, unzip and auto-import.
   */
  directDownloadUrl?: string;
  /** Files inside the zip to extract (if undefined, all files are used). */
  directDownloadFiles?: string[];
  license: string;
}

interface DictionaryGroup {
  label: string;
  entries: DictionaryEntry[];
}

const DICTIONARY_GROUPS: DictionaryGroup[] = [
  {
    label: 'English',
    entries: [
      {
        id: 'en-gcide',
        name: 'GNU GCIDE',
        description: "Webster's 1913 with WordNet additions — comprehensive monolingual English.",
        format: 'DICT',
        size: '~15 MB',
        source: 'gcide.gnu.org.ua',
        homepageUrl: 'https://gcide.gnu.org.ua/',
        downloadPageUrl: 'http://ftp.gnu.org/gnu/gcide/',
        license: 'GPL v3',
      },
      {
        id: 'en-wordnet',
        name: 'WordNet',
        description: 'Princeton WordNet — synsets, definitions and semantic relations.',
        format: 'DICT',
        size: '~6 MB',
        source: 'wordnet.princeton.edu',
        homepageUrl: 'https://wordnet.princeton.edu/',
        downloadPageUrl: 'https://wordnet.princeton.edu/download',
        license: 'Princeton WordNet License',
      },
      {
        id: 'en-wiktionary',
        name: 'English Wiktionary',
        description:
          'Full English Wiktionary for offline use — definitions, pronunciations, etymology.',
        format: 'Slob',
        size: '~250 MB',
        source: 'kiwix.org',
        homepageUrl: 'https://download.kiwix.org/zim/wiktionary/',
        license: 'CC BY-SA',
      },
    ],
  },
  {
    label: 'English – Chinese',
    entries: [
      {
        id: 'en-zh-ecdict-mdx',
        name: 'ECDICT (MDict)',
        description:
          'Enhanced English–Chinese dictionary: 340万+ entries with Collins/BNC frequency data. MDict format, ready to import.',
        format: 'MDict',
        size: '~93 MB (zip)',
        source: 'github.com/skywind3000/ECDICT',
        homepageUrl: 'https://github.com/skywind3000/ECDICT',
        downloadPageUrl: 'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
        directDownloadUrl:
          'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip',
        license: 'MIT',
      },
      {
        id: 'en-zh-ecdict-stardict',
        name: 'ECDICT (StarDict)',
        description:
          'Enhanced English–Chinese dictionary: 340万+ entries. StarDict format, ready to import.',
        format: 'StarDict',
        size: '~67 MB (zip)',
        source: 'github.com/skywind3000/ECDICT',
        homepageUrl: 'https://github.com/skywind3000/ECDICT',
        downloadPageUrl: 'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
        directDownloadUrl:
          'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-stardict-28.zip',
        license: 'MIT',
      },
      {
        id: 'en-zh-cc-cedict',
        name: 'CC-CEDICT',
        description: 'Community-maintained English–Chinese dictionary with 120,000+ entries.',
        format: 'StarDict',
        size: '~5 MB',
        source: 'mdbg.net',
        homepageUrl: 'https://www.mdbg.net/chinese/dictionary?page=cedict',
        downloadPageUrl: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip',
        license: 'CC BY-SA 4.0',
      },
    ],
  },
  {
    label: 'Japanese',
    entries: [
      {
        id: 'ja-jmdict',
        name: 'JMdict',
        description:
          'Standard Japanese–English dictionary with 200,000+ entries, kanji and readings.',
        format: 'StarDict',
        size: '~30 MB',
        source: 'edrdg.org',
        homepageUrl: 'https://www.edrdg.org/jmdict/j_jmdict.html',
        downloadPageUrl: 'https://github.com/FooSoft/yomichan/releases',
        license: 'CC BY-SA 4.0',
      },
    ],
  },
  {
    label: 'German',
    entries: [
      {
        id: 'de-wiktionary',
        name: 'Wiktionary Deutsch',
        description: 'German Wiktionary for offline use — Kiwix Slob edition.',
        format: 'Slob',
        size: '~120 MB',
        source: 'kiwix.org',
        homepageUrl: 'https://download.kiwix.org/zim/wiktionary/',
        license: 'CC BY-SA',
      },
      {
        id: 'en-de-fd',
        name: 'FreeDict English–German',
        description: 'Bilingual English–German dictionary from the FreeDict project.',
        format: 'StarDict',
        size: '~2 MB',
        source: 'freedict.org',
        homepageUrl: 'https://freedict.org/downloads/',
        license: 'GPL / CC',
      },
    ],
  },
  {
    label: 'French',
    entries: [
      {
        id: 'fr-wiktionary',
        name: 'Wiktionnaire',
        description: 'French Wiktionary for offline use — Kiwix Slob edition.',
        format: 'Slob',
        size: '~100 MB',
        source: 'kiwix.org',
        homepageUrl: 'https://download.kiwix.org/zim/wiktionary/',
        license: 'CC BY-SA',
      },
    ],
  },
  {
    label: 'Spanish',
    entries: [
      {
        id: 'es-wiktionary',
        name: 'Wikcionario',
        description: 'Spanish Wiktionary for offline use — Kiwix Slob edition.',
        format: 'Slob',
        size: '~90 MB',
        source: 'kiwix.org',
        homepageUrl: 'https://download.kiwix.org/zim/wiktionary/',
        license: 'CC BY-SA',
      },
      {
        id: 'en-es-fd',
        name: 'FreeDict English–Spanish',
        description: 'Bilingual English–Spanish dictionary from the FreeDict project.',
        format: 'StarDict',
        size: '~2 MB',
        source: 'freedict.org',
        homepageUrl: 'https://freedict.org/downloads/',
        license: 'GPL / CC',
      },
    ],
  },
  {
    label: 'Multilingual',
    entries: [
      {
        id: 'multi-freedict',
        name: 'FreeDict Collection',
        description: '170+ bilingual language pairs in StarDict format, all open-licensed.',
        format: 'StarDict',
        source: 'freedict.org',
        homepageUrl: 'https://freedict.org/downloads/',
        license: 'GPL / CC',
      },
      {
        id: 'multi-kiwix',
        name: 'Kiwix Wiktionary — All Languages',
        description: 'Wiktionary for 170+ languages in Slob format for offline use.',
        format: 'Slob',
        source: 'kiwix.org',
        homepageUrl: 'https://download.kiwix.org/zim/wiktionary/',
        license: 'CC BY-SA',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// In-app download logic
// ─────────────────────────────────────────────────────────────

/** Fetch a ZIP from url and return its entries as SelectedFile objects. */
async function fetchAndUnzipToFiles(url: string, filterFiles?: string[]): Promise<SelectedFile[]> {
  // Use Tauri's native HTTP client to bypass CORS restrictions in the webview.
  // For web builds, fall back to window.fetch (requires CORS headers on the server).
  const fetchFn = isTauri ? (tauriFetch as unknown as typeof fetch) : window.fetch.bind(window);
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const blob = await response.blob();

  const { BlobReader, ZipReader, BlobWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  await reader.close();

  const files: SelectedFile[] = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    const filename = entry.filename.split('/').pop() ?? entry.filename;
    if (!filename) continue;
    if (filterFiles && !filterFiles.includes(filename)) continue;
    // Skip macOS resource-fork junk
    if (filename.startsWith('._') || filename === '.DS_Store') continue;

    const writer = new BlobWriter();
    const fileBlob = await entry.getData!(writer);
    const file = new File([fileBlob], filename, { type: 'application/octet-stream' });
    files.push({ file, name: filename });
  }
  return files;
}

type DirectDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

// ─────────────────────────────────────────────────────────────
// Row component
// ─────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: DictionaryEntry;
  onOpenUrl: (url: string) => void;
  onDirectDownload: (entry: DictionaryEntry) => Promise<void>;
  directDownloadStatus: DirectDownloadStatus;
  _: (key: string, opts?: Record<string, string | number>) => string;
}

const EntryRow: React.FC<EntryRowProps> = ({
  entry,
  onOpenUrl,
  onDirectDownload,
  directDownloadStatus,
  _,
}) => {
  const isDownloading = directDownloadStatus === 'downloading';
  const isDone = directDownloadStatus === 'done';
  const isError = directDownloadStatus === 'error';

  return (
    <div className='flex items-start gap-3 py-3 pe-4'>
      {/* Text block */}
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
          <span className='text-base-content font-medium'>{entry.name}</span>
          <span className='badge badge-xs badge-ghost shrink-0'>{entry.format}</span>
          {entry.size && (
            <span className='text-base-content/40 shrink-0 text-[0.8em]'>{entry.size}</span>
          )}
        </div>
        <p className='text-base-content/60 mt-0.5 text-[0.85em] leading-relaxed'>
          {entry.description}
        </p>
        <p className='text-base-content/40 mt-0.5 text-[0.8em]'>
          {entry.source} · {entry.license}
        </p>
      </div>

      {/* Actions */}
      <div className='flex shrink-0 items-center gap-1 pt-0.5'>
        {/* Open in browser — always available */}
        <button
          type='button'
          onClick={() => onOpenUrl(entry.downloadPageUrl ?? entry.homepageUrl)}
          className='btn btn-ghost btn-xs text-base-content/50 hover:text-base-content gap-1'
          aria-label={_('Open in Browser')}
          title={_('Open in Browser')}
        >
          <MdOpenInNew className='h-3.5 w-3.5' />
          <span className='hidden sm:inline text-[0.85em]'>{_('Browser')}</span>
        </button>

        {/* Direct in-app download — only for entries with directDownloadUrl */}
        {entry.directDownloadUrl && (
          <button
            type='button'
            onClick={() => void onDirectDownload(entry)}
            disabled={isDownloading || isDone}
            className={clsx(
              'btn btn-xs gap-1',
              isDone
                ? 'btn-ghost text-success cursor-default'
                : isError
                  ? 'btn-ghost text-error'
                  : isDownloading
                    ? 'btn-ghost text-base-content/50 cursor-wait'
                    : 'btn-neutral',
            )}
            aria-label={_('Download and Import')}
            title={
              isDone
                ? _('Imported successfully')
                : isError
                  ? _('Download failed — try again')
                  : isDownloading
                    ? _('Downloading…')
                    : _('Download and import automatically')
            }
          >
            {isDone ? (
              <MdCheckCircleOutline className='h-3.5 w-3.5' />
            ) : isError ? (
              <MdErrorOutline className='h-3.5 w-3.5' />
            ) : isDownloading ? (
              /* Spinner */
              <svg className='h-3.5 w-3.5 animate-spin' viewBox='0 0 24 24' fill='none'>
                <circle
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                  className='opacity-25'
                />
                <path
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                  className='opacity-75'
                />
              </svg>
            ) : (
              <MdDownload className='h-3.5 w-3.5' />
            )}
            <span className='text-[0.85em]'>
              {isDone
                ? _('Imported')
                : isError
                  ? _('Retry')
                  : isDownloading
                    ? _('Downloading…')
                    : _('Download')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

interface DictionaryMarketplaceProps {
  onBack: () => void;
}

const DictionaryMarketplace: React.FC<DictionaryMarketplaceProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const {
    dictionaries,
    addDictionary,
    replaceDictionaries,
    markAvailableByContentId,
    saveCustomDictionaries,
  } = useCustomDictionaryStore();

  const [query, setQuery] = useState('');
  // Track per-entry direct-download state { [entryId]: status }
  const [dlStatus, setDlStatus] = useState<Record<string, DirectDownloadStatus>>({});
  // Abort controller per entry for future cancellation
  const abortRefs = useRef<Record<string, AbortController>>({});

  const q = query.toLowerCase().trim();
  const visibleGroups = q
    ? DICTIONARY_GROUPS.map((group) => ({
        ...group,
        entries: group.entries.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q) ||
            e.format.toLowerCase().includes(q),
        ),
      })).filter((group) => group.entries.length > 0)
    : DICTIONARY_GROUPS;

  const handleOpenUrl = async (url: string) => {
    if (isTauri) {
      await openUrl(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDirectDownload = async (entry: DictionaryEntry) => {
    if (!entry.directDownloadUrl || !appService) return;
    if (dlStatus[entry.id] === 'downloading' || dlStatus[entry.id] === 'done') return;

    setDlStatus((s) => ({ ...s, [entry.id]: 'downloading' }));
    try {
      const files = await fetchAndUnzipToFiles(entry.directDownloadUrl, entry.directDownloadFiles);
      if (files.length === 0) throw new Error('No valid dictionary files found in archive.');

      const result = await appService.importDictionaries(files, dictionaries);

      for (const dict of result.imported) {
        addDictionary(dict);
        if (dict.contentId) markAvailableByContentId(dict.contentId);
        if (appService) void queueDictionaryBinaryUpload(dict, appService);
      }
      for (const { oldIds, newDict } of result.replacements) {
        replaceDictionaries(oldIds, newDict);
        if (newDict.contentId) markAvailableByContentId(newDict.contentId);
        if (appService) void queueDictionaryBinaryUpload(newDict, appService);
        for (const oldId of oldIds) evictProvider(oldId);
      }

      await saveCustomDictionaries(envConfig, {
        publishOrderChange: result.imported.length > 0 || result.replacements.length > 0,
      });

      const added = result.imported.length;
      const replaced = result.replacements.length;
      if (added > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Imported {{count}} dictionary', { count: added }),
          timeout: 2500,
        });
      }
      if (replaced > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Updated {{count}} dictionary', { count: replaced }),
          timeout: 2500,
        });
      }

      setDlStatus((s) => ({ ...s, [entry.id]: 'done' }));
    } catch (err) {
      console.error('[DictionaryMarketplace] direct download failed:', err);
      setDlStatus((s) => ({ ...s, [entry.id]: 'error' }));
    } finally {
      delete abortRefs.current[entry.id];
    }
  };

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Dictionaries')}
        currentLabel={_('Get Dictionaries')}
        onBack={onBack}
      />

      {/* Search bar */}
      <div className='mb-4 px-4'>
        <input
          type='search'
          className='input input-sm input-bordered w-full'
          placeholder={_('Search dictionaries…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={_('Search dictionaries…')}
        />
      </div>

      {/* Dictionary groups */}
      {visibleGroups.length === 0 ? (
        <p className='text-base-content/60 px-4 py-6 text-center text-sm'>
          {_('No dictionaries match your search.')}
        </p>
      ) : (
        <div className='space-y-6'>
          {visibleGroups.map((group) => (
            <BoxedList key={group.label} title={_(group.label)}>
              {group.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onOpenUrl={(url) => void handleOpenUrl(url)}
                  onDirectDownload={handleDirectDownload}
                  directDownloadStatus={dlStatus[entry.id] ?? 'idle'}
                  _={_}
                />
              ))}
            </BoxedList>
          ))}
        </div>
      )}

      {/* Footer tips */}
      <Tips className='mt-6'>
        <li>
          {_(
            '"Download" fetches and imports the dictionary automatically. "Browser" opens the download page so you can get it manually.',
          )}
        </li>
        <li>
          {_(
            'After manual download, use "Import Dictionary" on the previous screen to add the files.',
          )}
        </li>
        <li>{_('All dictionaries listed here are open-source or freely redistributable.')}</li>
      </Tips>
    </div>
  );
};

export default DictionaryMarketplace;
