import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi, contentApi, themeApi, eventsApi, sessionsApi, pagesApi } from "../lib/api";

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [content, setContent] = useState(null);
  const [theme, setTheme] = useState(null);
  const [events, setEvents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const applyTheme = useCallback((t) => {
    if (!t) return;
    const root = document.documentElement;
    if (t.crimson) root.style.setProperty("--scale-crimson", t.crimson);
    if (t.dark_red) root.style.setProperty("--scale-darkred", t.dark_red);
    if (t.white) root.style.setProperty("--scale-white", t.white);
    if (t.off_white) root.style.setProperty("--scale-offwhite", t.off_white);
    if (t.black) root.style.setProperty("--scale-black", t.black);
    if (t.gold) root.style.setProperty("--scale-gold", t.gold);
    if (t.gold_light) root.style.setProperty("--scale-goldlight", t.gold_light);
    if (t.cream) root.style.setProperty("--scale-cream", t.cream);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [c, t, e, s, p] = await Promise.all([
        contentApi.get(), themeApi.get(), eventsApi.list(), sessionsApi.list(), pagesApi.list(),
      ]);
      setContent(c); setTheme(t); applyTheme(t); setEvents(e); setSessions(s); setPages(p);
      setLoadError(null);
      return true;
    } catch (err) {
      console.error("Load failed", err);
      // Distinguish a cold-start/slow-backend timeout from a real failure so the UI
      // can tell the user what's actually happening instead of hanging silently.
      const isTimeout = err.code === "ECONNABORTED" || /timeout/i.test(err.message || "");
      setLoadError(isTimeout ? "timeout" : "error");
      return false;
    }
  }, [applyTheme]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    const attempt = async (retryDelayMs) => {
      const ok = await loadAll();
      if (!ok && !cancelled) {
        // Keep retrying with a short, capped backoff — covers Render free-tier cold
        // starts (first request after idle can take 30-50s) without leaving the
        // splash screen stuck forever on a single failed attempt.
        retryTimer = setTimeout(() => attempt(Math.min(retryDelayMs * 1.5, 15000)), retryDelayMs);
      }
    };

    const init = async () => {
      try {
        const token = localStorage.getItem("scale_token");
        if (token) {
          try { const u = await authApi.me(); setUser(u); } catch { localStorage.removeItem("scale_token"); }
        }
        await attempt(3000);
      } finally { if (!cancelled) setLoading(false); }
    };
    init();

    // Refresh content + theme + events periodically so admin changes propagate to all open sessions
    const interval = setInterval(() => { loadAll(); }, 60 * 1000);
    // Refresh when the tab regains focus
    const onFocus = () => loadAll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadAll]);

  const login = async (email, password) => {
    const { token, user } = await authApi.login(email, password);
    localStorage.setItem("scale_token", token); setUser(user); return user;
  };
  const signup = async (email, password, name) => {
    const { token, user } = await authApi.signup(email, password, name);
    localStorage.setItem("scale_token", token); setUser(user); return user;
  };
  const logout = () => { localStorage.removeItem("scale_token"); setUser(null); setEditMode(false); };

  // Save partial content updates immediately (used by edit-in-place)
  const saveContentPatch = async (patch) => {
    const next = { ...(content || {}), ...patch };
    setContent(next);
    await contentApi.put(next);
  };
  const refreshContent = async () => setContent(await contentApi.get());
  const refreshTheme = async () => { const t = await themeApi.get(); setTheme(t); applyTheme(t); };
  const refreshEvents = async () => setEvents(await eventsApi.list());
  const refreshSessions = async () => setSessions(await sessionsApi.list());
  const refreshPages = async () => setPages(await pagesApi.list());

  const isAdmin = user?.role === "admin";
  const editing = isAdmin && editMode;

  return (
    <AppContext.Provider
      value={{
        user, content, theme, events, sessions, pages, loading, loadError, retryLoad: loadAll,
        login, signup, logout,
        refreshContent, refreshTheme, refreshEvents, refreshSessions, refreshPages,
        applyTheme, isAdmin, editMode, setEditMode, editing,
        saveContentPatch,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
};
