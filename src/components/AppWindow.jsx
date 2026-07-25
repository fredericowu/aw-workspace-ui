// AppWindow — Content-only module, no chrome of its own (WindowShell owns
// title/icon/chrome buttons/drag/resize/focus/z-order — see the Architect's
// composition decision, run 2fa7f8d5, target aw-microfrontend-architecture).
//
// 1:1 port of the prototype's src/components/AppWindow.js — that file was
// already JSX-shaped (createElement + hooks), this is the same component
// rewritten with real JSX and a real `import React from 'react'` instead of
// the esm.sh CDN import (the prototype has no build step, this repo does).
//
// Modeled on the real AppProxyWindow (src/app/src/components/
// WindowManager.jsx) — reduced here still: no real iframe/websocket, iframe
// content is still a visual mock (first pass; see repo README's parity
// table for what's deferred).
//
// `app.registryInfo` (optional): a real entry from GET /api/windows/registry
// on the awserv-family backend — { type, name, icon, description, singleton }.
// When present it replaces the purely-mocked description line below the
// iframe badge; the iframe itself stays a mock either way.
//
// Logs view — search ported from the real LogWindow.jsx (src/app/src/
// components/LogWindow.jsx): Cmd/Ctrl+F or the search icon opens a search
// bar, matches highlight live, Enter/Shift+Enter or the prev/next buttons
// step through them, Escape closes it. No ANSI-parsing here (mock lines are
// plain text; LogWindow's ANSI handling is for real terminal output).

import { useEffect, useMemo, useRef, useState } from "react";

export const descriptor = {
  icon: "bolt",
  chrome: { minimize: false, maximize: true, close: true },
  size: { width: 640, height: 440 },
  singleton: false,
};

// Mock log lines — LogStream/LogWindow's real content streams over a
// websocket from the running component's actual stdout; this first pass has
// no such backend wiring yet, so a fixed, believable-looking log is
// generated once per mount (varied enough that searching has something to
// find and navigate between, e.g. multiple "GET", "info", "listening" hits).
function buildMockLogLines(app) {
  const label = app.label || app.key || "app";
  const port = app.port ? ` on :${app.port}` : "";
  return [
    `[boot] ${label} starting…`,
    `[info] loading configuration from .env`,
    `[info] connecting to database pool (5 connections)`,
    `[ok] listening${port}`,
    `[ok] health check passed`,
    `[info] GET /api/status 200 12ms`,
    `[info] GET /api/data 200 8ms`,
    `[warn] cache miss for key "session:483"`,
    `[info] GET /api/data 200 6ms`,
    `[error] upstream timeout after 5000ms, retrying`,
    `[info] retry succeeded on attempt 2`,
    `[info] GET /api/status 200 9ms`,
    `[info] background job "cleanup" completed in 340ms`,
    `[info] websocket client connected (id=ws-8841)`,
    `[info] websocket client disconnected (id=ws-8841)`,
    `[info] memory usage 128MB / 512MB`,
    `… waiting for next log line (mock)`,
  ];
}

function IconSearch({ style }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, ...style }}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function IconClose({ style }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13, ...style }}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconChevPrev() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function IconChevNext() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function Content({ app }) {
  const [view, setView] = useState("app"); // 'app' | 'logs'
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [logLines] = useState(() => buildMockLogLines(app));
  const searchInputRef = useRef(null);
  const matchRefs = useRef([]);

  const isRunning = app.running ?? (app.status === "running" || app.status === "boot");
  const registry = app.registryInfo;

  // Compute all search matches: [{lineIdx, startIdx}] — same shape/logic as
  // LogWindow.jsx's `matches` memo.
  const matches = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    const result = [];
    logLines.forEach((line, lineIdx) => {
      const lower = line.toLowerCase();
      let pos = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        result.push({ lineIdx, startIdx: pos });
        pos += q.length;
      }
    });
    return result;
  }, [logLines, searchQuery]);

  useEffect(() => {
    setActiveMatchIdx(0);
  }, [searchQuery]);

  useEffect(() => {
    if (matches.length > 0 && matchRefs.current[activeMatchIdx]) {
      matchRefs.current[activeMatchIdx].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeMatchIdx, matches.length]);

  matchRefs.current = [];
  let globalMatchCounter = 0;

  const goNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIdx((prev) => (prev + 1) % matches.length);
  };

  const goPrevMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIdx((prev) => (prev - 1 + matches.length) % matches.length);
  };

  const openSearch = () => {
    setSearchVisible(true);
    setTimeout(() => searchInputRef.current && searchInputRef.current.focus(), 50);
  };

  const closeSearch = () => {
    setSearchVisible(false);
    setSearchQuery("");
  };

  const toggleSearch = () => {
    if (searchVisible) closeSearch();
    else openSearch();
  };

  const handleLogsKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape" && searchVisible) {
      closeSearch();
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Escape") {
      closeSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) goPrevMatch();
      else goNextMatch();
    }
  };

  // Render a single line with search highlights — mirrors LogWindow.jsx's
  // renderLine/highlightSearch.
  function renderLogLine(line, lineIdx) {
    const isDim = lineIdx === logLines.length - 1;
    if (!searchQuery || !line.toLowerCase().includes(searchQuery.toLowerCase())) {
      return (
        <div key={lineIdx} className={`appwin-log-line${isDim ? " dim" : ""}`}>
          {line}
        </div>
      );
    }
    const q = searchQuery.toLowerCase();
    const lower = line.toLowerCase();
    const parts = [];
    let lastIdx = 0;
    let idx = lower.indexOf(q);
    let localMatch = 0;
    while (idx !== -1) {
      if (idx > lastIdx) parts.push(line.slice(lastIdx, idx));
      const globalIdx = globalMatchCounter + localMatch;
      const isActive = globalIdx === activeMatchIdx;
      parts.push(
        <mark
          key={`${lineIdx}-${idx}`}
          ref={(el) => {
            if (el) matchRefs.current[globalIdx] = el;
          }}
          className={isActive ? "search-hit search-hit-active" : "search-hit"}
        >
          {line.slice(idx, idx + searchQuery.length)}
        </mark>
      );
      localMatch++;
      lastIdx = idx + searchQuery.length;
      idx = lower.indexOf(q, lastIdx);
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx));
    globalMatchCounter += localMatch;
    return (
      <div key={lineIdx} className={`appwin-log-line${isDim ? " dim" : ""}`}>
        {parts}
      </div>
    );
  }

  const searchHasQuery = searchQuery.length > 0;
  const searchNoResults = searchHasQuery && matches.length === 0;

  return (
    <div className="appwin">
      <div className="appwin-toolbar">
        <span className={`appwin-status-dot ${isRunning ? "running" : "off"}`} title={isRunning ? "Running" : "Not running"} />
        <span className="appwin-toolbar-label">{isRunning ? "Running" : "Stopped"}</span>
        <div className="appwin-spacer" />
        {view === "logs" ? (
          <button
            type="button"
            className={`appwin-search-btn ${searchVisible ? "active" : ""}`}
            onClick={toggleSearch}
            title={searchVisible ? "Close search" : "Search logs (Cmd+F)"}
          >
            <IconSearch />
          </button>
        ) : null}
        <button
          type="button"
          className={`appwin-toggle ${view === "logs" ? "active" : ""}`}
          onClick={() => setView((v) => (v === "logs" ? "app" : "logs"))}
          title={view === "logs" ? "Show app" : "Show component logs"}
        >
          {view === "logs" ? "App" : "Logs"}
        </button>
      </div>

      <div className="appwin-content">
        {view === "app" ? (
          <div className="appwin-iframe-mock">
            <span className="appwin-iframe-badge">{app.port ? `:${app.port}` : registry?.type || "app"}</span>
            <p>{`Preview of "${app.label || app.key}"`}</p>
            {registry ? (
              <p className="appwin-muted">{`${registry.name} — ${registry.description}`}</p>
            ) : (
              <p className="appwin-muted">(iframe mock — no real app embedded)</p>
            )}
          </div>
        ) : (
          <div className="appwin-logs-view">
            {searchVisible ? (
              <div className={`appwin-search-bar ${searchNoResults ? "no-results" : ""}`}>
                <IconSearch style={{ flexShrink: 0 }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search logs…"
                  className="appwin-search-input"
                />
                {searchHasQuery ? (
                  <div className="appwin-search-nav">
                    <span className="appwin-search-count">
                      {matches.length === 0 ? "No matches" : `${activeMatchIdx + 1} / ${matches.length}`}
                    </span>
                    <button type="button" onClick={goPrevMatch} disabled={matches.length === 0} title="Previous (Shift+Enter)">
                      <IconChevPrev />
                    </button>
                    <button type="button" onClick={goNextMatch} disabled={matches.length === 0} title="Next (Enter)">
                      <IconChevNext />
                    </button>
                  </div>
                ) : null}
                <button type="button" className="appwin-search-close" onClick={closeSearch} title="Close search (Escape)">
                  <IconClose />
                </button>
              </div>
            ) : null}
            <div className="appwin-logs" tabIndex={0} onKeyDown={handleLogsKeyDown}>
              {logLines.map((line, i) => renderLogLine(line, i))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
