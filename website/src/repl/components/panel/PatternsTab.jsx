import {
  exportPatterns,
  importPatterns,
  loadAndSetFeaturedPatterns,
  loadAndSetPublicPatterns,
  patternFilterName,
  useActivePattern,
  useViewingPatternData,
  userPattern,
} from '../../../user_pattern_utils.mjs';
import { useMemo } from 'react';
import { getMetadata } from '../../../metadata_parser.js';
import { useExamplePatterns } from '../../useExamplePatterns.jsx';
import { parseJSON, isUdels } from '../../util.mjs';
import { ButtonGroup } from './Forms.jsx';
import { settingsMap, useSettings } from '../../../settings.mjs';
import { Pagination } from '../pagination/Pagination.jsx';
import { useState } from 'react';
import { useDebounce } from '../usedebounce.jsx';
import cx from '@src/cx.mjs';

export function PatternLabel({ pattern, children } /* : { pattern: Tables<'code'> } */) {
  const meta = useMemo(() => getMetadata(pattern.code), [pattern]);

  let title = meta.title;
  if (title == null) {
    const date = new Date(pattern.created_at);
    if (!isNaN(date)) {
      title = date.toLocaleDateString();
    } else {
      title = 'unnamed';
    }
  }

  const author = Array.isArray(meta.by) ? meta.by.join(',') : 'Anonymous';
  return <>{`${pattern.id}: ${title} by ${author.slice(0, 100)}`.slice(0, 60)}</>;
}

function PatternButton({ showOutline, onClick, pattern, showHiglight, context }) {
  return (
    <div className="mr-4 block">
      <div className="flex items-center justify-between gap-2 relative">
        <a
          className={cx(
            'hover:opacity-50 cursor-pointer inline-block flex-1 min-w-0',
            showOutline && 'outline outline-1',
            showHiglight && 'bg-selection',
          )}
          onClick={onClick}
        >
          <PatternLabel pattern={pattern} />
        </a>
        {!!context?.patternRecordings?.[pattern.id]?.length && (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <details>
              <summary className="text-xs cursor-pointer hover:opacity-70 px-1">recordings</summary>
              <div className="absolute right-0 mt-1 bg-background text-foreground shadow-md border border-lineHighlight p-2 z-[300] max-h-64 overflow-auto min-w-[240px] rounded-md">
                {context.patternRecordings[pattern.id].map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between space-x-2 py-1">
                    <span className="text-[10px] opacity-80 truncate">
                      {new Date(r.createdAt).toLocaleTimeString()} • {(r.size / 1024).toFixed(0)} KB
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-[12px] hover:opacity-75"
                        title="download"
                        onClick={(e) => {
                          e.stopPropagation();
                          context.handleDownloadFromList(r.url);
                        }}
                      >
                        ⬇️
                      </button>
                      <button
                        className="text-[12px] hover:opacity-75"
                        title="save to samples"
                        onClick={(e) => {
                          e.stopPropagation();
                          context.handlePersistRecording(r.url);
                        }}
                      >
                        💾
                      </button>
                      <button
                        className="text-[12px] hover:opacity-75 text-red-600"
                        title="delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          context.handleDeleteRecording(pattern.id, r.url);
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function PatternButtons({ patterns, activePattern, onClick, started, context }) {
  const viewingPatternStore = useViewingPatternData();
  const viewingPatternData = parseJSON(viewingPatternStore);
  const viewingPatternID = viewingPatternData.id;
  return (
    <div className="">
      {Object.values(patterns)
        .reverse()
        .map((pattern) => {
          const id = pattern.id;
          return (
            <PatternButton
              pattern={pattern}
              key={id}
              showHiglight={id === viewingPatternID}
              showOutline={id === activePattern && started}
              onClick={() => onClick(id)}
              context={context}
            />
          );
        })}
    </div>
  );
}

function ActionButton({ children, onClick, label, labelIsHidden }) {
  return (
    <button className="hover:opacity-50 text-nowrap" onClick={onClick} title={label}>
      {labelIsHidden !== true && label}
      {children}
    </button>
  );
}

const updateCodeWindow = (context, patternData, reset = false) => {
  context.handleUpdate(patternData, reset);
};

const autoResetPatternOnChange = !isUdels();

function UserPatterns({ context }) {
  const activePattern = useActivePattern();
  const viewingPatternStore = useViewingPatternData();
  const viewingPatternData = parseJSON(viewingPatternStore);
  const { userPatterns, patternFilter } = useSettings();
  const viewingPatternID = viewingPatternData?.id;
  return (
    <div className="flex flex-col gap-2 flex-grow overflow-hidden h-full pb-2 ">
      <div className="pr-4 space-x-4  flex max-w-full overflow-x-auto">
        <ActionButton
          label="new"
          onClick={() => {
            const { data } = userPattern.createAndAddToDB();
            updateCodeWindow(context, data);
          }}
        />
        <ActionButton
          label="duplicate"
          onClick={() => {
            const { data } = userPattern.duplicate(viewingPatternData);
            updateCodeWindow(context, data);
          }}
        />
        <ActionButton
          label="delete"
          onClick={() => {
            const { data } = userPattern.delete(viewingPatternID);
            updateCodeWindow(context, { ...data, collection: userPattern.collection });
          }}
        />
        <label className="hover:opacity-50 cursor-pointer">
          <input
            style={{ display: 'none' }}
            type="file"
            multiple
            accept="text/plain,text/x-markdown,application/json"
            onChange={(e) => importPatterns(e.target.files)}
          />
          import
        </label>
        <ActionButton label="export" onClick={exportPatterns} />

        <ActionButton
          label="delete-all"
          onClick={() => {
            const { data } = userPattern.clearAll();
            updateCodeWindow(context, data);
          }}
        />
      </div>

      <div className="overflow-auto h-full bg-background p-2 rounded-md">
        {/* {patternFilter === patternFilterName.user && ( */}
        <PatternButtons
          onClick={(id) =>
            updateCodeWindow(
              context,
              { ...userPatterns[id], collection: userPattern.collection },
              autoResetPatternOnChange,
            )
          }
          patterns={userPatterns}
          started={context.started}
          activePattern={activePattern}
          viewingPatternID={viewingPatternID}
          context={context}
        />
        {/* )} */}
      </div>
    </div>
  );
}

function PatternPageWithPagination({ patterns, patternOnClick, context, paginationOnChange, initialPage }) {
  const [page, setPage] = useState(initialPage);
  const debouncedPageChange = useDebounce(() => {
    paginationOnChange(page);
  });

  const onPageChange = (pageNum) => {
    setPage(pageNum);
    debouncedPageChange();
  };

  const activePattern = useActivePattern();
  return (
    <div className="flex flex-grow flex-col  h-full overflow-hidden justify-between">
      <div className="overflow-auto flex flex-col flex-grow bg-background p-2 rounded-md ">
        <PatternButtons
          onClick={(id) => patternOnClick(id)}
          started={context.started}
          patterns={patterns}
          activePattern={activePattern}
        />
      </div>
      <div className="flex items-center gap-2 py-2">
        <label htmlFor="pattern pagination">Page</label>
        <Pagination id="pattern pagination" currPage={page} onPageChange={onPageChange} />
      </div>
    </div>
  );
}

let featuredPageNum = 1;
function FeaturedPatterns({ context }) {
  const examplePatterns = useExamplePatterns();
  const collections = examplePatterns.collections;
  const patterns = collections.get(patternFilterName.featured);
  return (
    <PatternPageWithPagination
      patterns={patterns}
      context={context}
      initialPage={featuredPageNum}
      patternOnClick={(id) => {
        updateCodeWindow(
          context,
          { ...patterns[id], collection: patternFilterName.featured },
          autoResetPatternOnChange,
        );
      }}
      paginationOnChange={async (pageNum) => {
        await loadAndSetFeaturedPatterns(pageNum - 1);
        featuredPageNum = pageNum;
      }}
    />
  );
}

let latestPageNum = 1;
function LatestPatterns({ context }) {
  const examplePatterns = useExamplePatterns();
  const collections = examplePatterns.collections;
  const patterns = collections.get(patternFilterName.public);
  return (
    <PatternPageWithPagination
      patterns={patterns}
      context={context}
      initialPage={latestPageNum}
      patternOnClick={(id) => {
        updateCodeWindow(context, { ...patterns[id], collection: patternFilterName.public }, autoResetPatternOnChange);
      }}
      paginationOnChange={async (pageNum) => {
        await loadAndSetPublicPatterns(pageNum - 1);
        latestPageNum = pageNum;
      }}
    />
  );
}

function PublicPatterns({ context }) {
  const { patternFilter } = useSettings();
  if (patternFilter === patternFilterName.featured) {
    return <FeaturedPatterns context={context} />;
  }
  return <LatestPatterns context={context} />;
}

export function PatternsTab({ context }) {
  const { patternFilter } = useSettings();

  return (
    <div className="px-4 w-full text-foreground  space-y-2  flex flex-col overflow-hidden max-h-full h-full">
      <UserPatterns context={context} />
    </div>
  );
  /* return (
    <div className="px-4 w-full text-foreground  space-y-2  flex flex-col overflow-hidden max-h-full h-full">
      <ButtonGroup
        value={patternFilter}
        onChange={(value) => settingsMap.setKey('patternFilter', value)}
        items={patternFilterName}
      ></ButtonGroup>

      {patternFilter === patternFilterName.user ? (
        <UserPatterns context={context} />
      ) : (
        <PublicPatterns context={context} />
      )}
    </div>
  ); */
}
