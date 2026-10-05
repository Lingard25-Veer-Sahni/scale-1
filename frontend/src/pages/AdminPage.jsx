import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { contentApi, themeApi, eventsApi, sessionsApi, submissionsApi, registrationsApi, pagesApi, eventMaterialsApi, eventSubmissionsApi, communityApi, teamApi, uploadsApi } from "../lib/api";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Slider } from "../components/ui/slider";
import { Plus, Trash2, Save, RefreshCw, ExternalLink, Upload, Download, Link as LinkIcon, FileText } from "lucide-react";

export default function AdminPage() {
  const { user, logout, refreshContent, refreshTheme, refreshEvents, refreshSessions, refreshPages, applyTheme, setEditMode } = useApp();
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [theme, setTheme] = useState(null);
  const [events, setEvents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [pages, setPages] = useState([]);
  const [community, setCommunity] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate("/login", { state: { from: "/admin" } }); return; }
    if (user.role !== "admin") { toast.error("Admin access only."); navigate("/"); return; }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, t, e, s, subs, regs, comm, team] = await Promise.all([
        contentApi.get(), themeApi.get(), eventsApi.list(), sessionsApi.list(),
        submissionsApi.list(), registrationsApi.list(), communityApi.list(), teamApi.list(),
      ]);
      setContent(c); setTheme(t); setEvents(e); setSessions(s); setSubmissions(subs); setRegistrations(regs);
      setCommunity(comm); setTeamMembers(team);
    } catch { toast.error("Failed to load admin data."); }
    finally { setLoading(false); }
  };

  if (loading || !content) {
    return <div className="min-h-screen flex items-center justify-center"><div className="font-serif text-xl">Loading admin console…</div></div>;
  }

  const setC = (k, v) => setContent((c) => ({ ...c, [k]: v }));

  const saveContent = async () => {
    try { await contentApi.put(content); await refreshContent(); toast.success("Content saved."); }
    catch { toast.error("Save failed."); }
  };
  const saveTheme = async () => {
    try { await themeApi.put(theme); applyTheme(theme); await refreshTheme(); toast.success("Theme saved."); }
    catch { toast.error("Save failed."); }
  };

  return (
    <div className="min-h-screen bg-[var(--scale-offwhite)]" data-testid="admin-page">
      <div className="bg-[var(--scale-black)] text-white py-4">
        <div className="max-container flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--scale-goldlight)] font-bold">SCALE Admin</div>
            <h1 className="font-serif font-black text-2xl">CMS Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadAll} className="nav-link flex items-center gap-2 text-sm"><RefreshCw size={14} /> Reload</button>
            <button
              onClick={() => { setEditMode(true); navigate("/"); }}
              className="nav-link text-sm flex items-center gap-2"
              data-testid="admin-inline-edit-btn"
            >
              <ExternalLink size={14} /> Inline Edit Site
            </button>
            <button onClick={() => navigate("/")} className="nav-link text-sm">View Site</button>
            <button onClick={() => { logout(); navigate("/"); }} className="nav-link text-sm" data-testid="admin-logout">Logout</button>
          </div>
        </div>
      </div>

      <div className="max-container py-8">
        <Tabs defaultValue="content">
          <TabsList className="bg-white border border-black/10 p-1 flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="content" data-testid="tab-content">Content</TabsTrigger>
            <TabsTrigger value="events" data-testid="tab-events">Events</TabsTrigger>
            <TabsTrigger value="pages" data-testid="tab-pages">Pages</TabsTrigger>
            <TabsTrigger value="community" data-testid="tab-community">Community</TabsTrigger>
            <TabsTrigger value="team" data-testid="tab-team">Team</TabsTrigger>
            <TabsTrigger value="sessions" data-testid="tab-sessions">Sessions</TabsTrigger>
            <TabsTrigger value="theme" data-testid="tab-theme">Theme</TabsTrigger>
            <TabsTrigger value="registrations" data-testid="tab-registrations">Registrations ({registrations.length})</TabsTrigger>
            <TabsTrigger value="submissions" data-testid="tab-submissions">Other Submissions ({submissions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="mt-6">
            <div className="bg-white p-6 border border-black/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif font-bold text-2xl">Edit text content</h2>
                <button onClick={saveContent} className="btn-crimson text-sm" data-testid="save-content-btn"><Save size={14} /> Save</button>
              </div>
              <p className="text-sm text-black/60 mb-4">
                Tip: you can also click <strong>Inline Edit Site</strong> above to edit text directly on the homepage.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Hero label"><Input value={content.hero_label || ""} onChange={(e) => setC("hero_label", e.target.value)} /></F>
                <F label="Hero CTA primary"><Input value={content.hero_cta_primary || ""} onChange={(e) => setC("hero_cta_primary", e.target.value)} /></F>
                <F label="Hero headline" full><Textarea rows={2} value={content.hero_headline || ""} onChange={(e) => setC("hero_headline", e.target.value)} /></F>
                <F label="Hero subtext" full><Textarea rows={3} value={content.hero_subtext || ""} onChange={(e) => setC("hero_subtext", e.target.value)} /></F>
                <F label="Hero CTA secondary"><Input value={content.hero_cta_secondary || ""} onChange={(e) => setC("hero_cta_secondary", e.target.value)} /></F>
                <F label="Fields (comma-separated)" full>
                  <Input value={(content.fields_strip || []).join(", ")}
                    onChange={(e) => setC("fields_strip", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} />
                </F>

                <F label="Upcoming event title"><Input value={content.upcoming_event_title || ""} onChange={(e) => setC("upcoming_event_title", e.target.value)} /></F>
                <F label="Upcoming event date"><Input value={content.upcoming_event_date || ""} onChange={(e) => setC("upcoming_event_date", e.target.value)} /></F>
                <F label="Upcoming event desc" full><Textarea rows={2} value={content.upcoming_event_desc || ""} onChange={(e) => setC("upcoming_event_desc", e.target.value)} /></F>

                <F label="About paragraph" full><Textarea rows={4} value={content.about_paragraph || ""} onChange={(e) => setC("about_paragraph", e.target.value)} /></F>
                <F label="Competitions teaser" full><Textarea rows={2} value={content.competitions_teaser || ""} onChange={(e) => setC("competitions_teaser", e.target.value)} /></F>

                <F label="Community eyebrow"><Input value={content.community_eyebrow || ""} onChange={(e) => setC("community_eyebrow", e.target.value)} /></F>
                <F label="Community headline"><Input value={content.community_headline || ""} onChange={(e) => setC("community_headline", e.target.value)} /></F>
                <F label="Community about" full><Textarea rows={3} value={content.community_about || ""} onChange={(e) => setC("community_about", e.target.value)} /></F>
                <F label="Community page visibility" full>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={content.community_page_visible !== false}
                      onChange={(e) => setC("community_page_visible", e.target.checked)}
                      data-testid="content-community-page-visible"
                    />
                    Show "Community" page (nav link + direct access)
                  </label>
                </F>

                <F label="Team eyebrow"><Input value={content.team_eyebrow || ""} onChange={(e) => setC("team_eyebrow", e.target.value)} /></F>
                <F label="Team headline"><Input value={content.team_headline || ""} onChange={(e) => setC("team_headline", e.target.value)} /></F>
                <F label="Team about" full><Textarea rows={3} value={content.team_about || ""} onChange={(e) => setC("team_about", e.target.value)} /></F>
                <F label="Team page visibility" full>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={content.team_page_visible !== false}
                      onChange={(e) => setC("team_page_visible", e.target.checked)}
                      data-testid="content-team-page-visible"
                    />
                    Show "Our Team" page (nav link + direct access)
                  </label>
                </F>

                <F label="Contact email"><Input value={content.contact_email || ""} onChange={(e) => setC("contact_email", e.target.value)} /></F>
                <F label="Contact Instagram"><Input value={content.contact_instagram || ""} onChange={(e) => setC("contact_instagram", e.target.value)} /></F>
                <F label="Contact LinkedIn"><Input value={content.contact_linkedin || ""} onChange={(e) => setC("contact_linkedin", e.target.value)} /></F>
                <F label="Footer tagline" full><Input value={content.footer_tagline || ""} onChange={(e) => setC("footer_tagline", e.target.value)} /></F>
              </div>

              <PillarsEditor content={content} setContent={setContent} />
              <WhyEditor content={content} setContent={setContent} />

              <div className="mt-6 text-right">
                <button onClick={saveContent} className="btn-crimson text-sm"><Save size={14} /> Save all</button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="events" className="mt-6">
            <EventsAdmin events={events} reload={async () => { setEvents(await eventsApi.list()); refreshEvents(); }} />
          </TabsContent>

          <TabsContent value="pages" className="mt-6">
            <PagesAdmin
              pages={pages}
              reload={async () => { setPages(await pagesApi.adminList()); refreshPages(); }}
            />
          </TabsContent>

          <TabsContent value="community" className="mt-6">
            <CommunityAdmin community={community} reload={async () => setCommunity(await communityApi.list())} />
          </TabsContent>

          <TabsContent value="team" className="mt-6">
            <TeamAdmin members={teamMembers} reload={async () => setTeamMembers(await teamApi.list())} />
          </TabsContent>

          <TabsContent value="sessions" className="mt-6">
            <SessionsAdmin sessions={sessions} reload={async () => { setSessions(await sessionsApi.list()); refreshSessions(); }} />
          </TabsContent>

          <TabsContent value="theme" className="mt-6">
            <div className="bg-white p-6 border border-black/10 max-w-3xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif font-bold text-2xl">Theme colours</h2>
                <button onClick={saveTheme} className="btn-crimson text-sm" data-testid="save-theme-btn"><Save size={14} /> Save</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  ["crimson", "Crimson"], ["dark_red", "Dark Red"], ["white", "White"],
                  ["off_white", "Off-White"], ["cream", "Cream"], ["black", "Black"],
                  ["gold", "Gold"], ["gold_light", "Gold Light"],
                ].map(([k, label]) => (
                  <F key={k} label={label}>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={theme[k] || "#000000"} onChange={(e) => setTheme({ ...theme, [k]: e.target.value })} className="h-10 w-14 border" />
                      <Input value={theme[k] || ""} onChange={(e) => setTheme({ ...theme, [k]: e.target.value })} />
                    </div>
                  </F>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="registrations" className="mt-6">
            <RegistrationsAdmin registrations={registrations} />
          </TabsContent>

          <TabsContent value="submissions" className="mt-6">
            <SubmissionsAdmin submissions={submissions} reload={async () => setSubmissions(await submissionsApi.list())} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function F({ label, children, full }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <Label className="text-xs uppercase tracking-wider font-semibold text-black/70">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function PillarsEditor({ content, setContent }) {
  const pillars = content.pillars || [];
  const update = (i, k, v) => {
    const p = [...pillars]; p[i] = { ...p[i], [k]: v }; setContent({ ...content, pillars: p });
  };
  return (
    <div className="mt-8">
      <div className="eyebrow">Pillars</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        {pillars.map((p, i) => (
          <div key={i} className="border border-black/10 p-4">
            <Input className="mb-2 font-semibold" value={p.title} onChange={(e) => update(i, "title", e.target.value)} placeholder="Title" />
            <Textarea rows={2} value={p.desc} onChange={(e) => update(i, "desc", e.target.value)} placeholder="Description" />
          </div>
        ))}
      </div>
    </div>
  );
}

function WhyEditor({ content, setContent }) {
  const items = content.why_scale_items || [];
  const update = (i, k, v) => {
    const arr = [...items]; arr[i] = { ...arr[i], [k]: v }; setContent({ ...content, why_scale_items: arr });
  };
  const add = () => setContent({ ...content, why_scale_items: [...items, { title: "", desc: "" }] });
  const remove = (i) => setContent({ ...content, why_scale_items: items.filter((_, idx) => idx !== i) });
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Why SCALE items</div>
        <button onClick={add} className="btn-outline-dark text-xs"><Plus size={12} /> Add item</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
        {items.map((p, i) => (
          <div key={i} className="border border-black/10 p-4 relative">
            <button onClick={() => remove(i)} className="absolute top-2 right-2 text-black/40 hover:text-[var(--scale-crimson)]"><Trash2 size={14} /></button>
            <Input className="mb-2 font-semibold" value={p.title} onChange={(e) => update(i, "title", e.target.value)} placeholder="Title" />
            <Textarea rows={3} value={p.desc} onChange={(e) => update(i, "desc", e.target.value)} placeholder="Description" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EventsAdmin({ events, reload }) {
  const empty = {
    title: "", description: "", about: "", status: "live", cta_label: "Event Details",
    date: "", location: "", price_inr: 500, order: events.length + 1,
    registration_mode: "individual", team_size_min: 2, team_size_max: 5,
    eligibility: "", extra_fields: [],
    registration_open: true,
    registration_closed_message: "Registration is currently closed for this event. Check back soon.",
  };
  const [draft, setDraft] = useState(empty);
  const add = async () => {
    if (!draft.title) return toast.error("Title required");
    await eventsApi.create(draft);
    toast.success("Event added.");
    setDraft({ ...empty, order: events.length + 2 });
    reload();
  };
  const save = async (e) => { await eventsApi.update(e.id, e); toast.success("Saved."); reload(); };
  const remove = async (id) => { if (window.confirm("Delete event?")) { await eventsApi.remove(id); reload(); } };
  return (
    <div className="bg-white p-6 border border-black/10">
      <h2 className="font-serif font-bold text-2xl mb-4">Events</h2>
      <div className="space-y-4">
        {events.map((e, idx) => <EventRow key={e.id} initial={e} onSave={save} onRemove={remove} index={idx} />)}
      </div>
      <div className="mt-8 border-t pt-6">
        <h3 className="font-serif font-bold text-lg mb-3">Add new event</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="new-event-title" />
          <Input placeholder="Date / tag" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <Input placeholder="Location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          <Input type="number" placeholder="Price ₹" value={draft.price_inr} onChange={(e) => setDraft({ ...draft, price_inr: parseFloat(e.target.value || "0") })} />
          <Textarea rows={2} className="md:col-span-2" placeholder="Short description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <Textarea rows={3} className="md:col-span-2" placeholder="Long-form about (shown on detail page)" value={draft.about} onChange={(e) => setDraft({ ...draft, about: e.target.value })} />
          <Textarea rows={2} className="md:col-span-2" placeholder="Eligibility (per-event, shown on detail page)" value={draft.eligibility} onChange={(e) => setDraft({ ...draft, eligibility: e.target.value })} />
          <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="coming_soon">Coming Soon</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Order" value={draft.order} onChange={(e) => setDraft({ ...draft, order: parseInt(e.target.value || "0", 10) })} />
          <Select value={draft.registration_mode} onValueChange={(v) => setDraft({ ...draft, registration_mode: v })}>
            <SelectTrigger data-testid="new-event-mode"><SelectValue placeholder="Registration mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="team">Team</SelectItem>
            </SelectContent>
          </Select>
          {draft.registration_mode === "team" ? (
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" placeholder="Min team size" value={draft.team_size_min} onChange={(e) => setDraft({ ...draft, team_size_min: parseInt(e.target.value || "2", 10) })} />
              <Input type="number" placeholder="Max team size" value={draft.team_size_max} onChange={(e) => setDraft({ ...draft, team_size_max: parseInt(e.target.value || "5", 10) })} />
            </div>
          ) : <div />}
          <div className="md:col-span-2">
            <ExtraFieldsEditor
              value={draft.extra_fields}
              onChange={(xs) => setDraft({ ...draft, extra_fields: xs })}
              allowMemberScope={draft.registration_mode === "team"}
            />
          </div>
        </div>
        <button onClick={add} className="btn-crimson text-sm mt-3" data-testid="add-event-btn"><Plus size={14} /> Add event</button>
      </div>
    </div>
  );
}

function EventRow({ initial, onSave, onRemove, index }) {
  const normalize = (src) => ({
    registration_mode: "individual", team_size_min: 2, team_size_max: 5,
    eligibility: "", extra_fields: [],
    registration_open: true,
    registration_closed_message: "Registration is currently closed for this event. Check back soon.",
    ...src,
  });
  const [savedSnapshot, setSavedSnapshot] = useState(() => normalize(initial));
  const [e, setE] = useState(() => normalize(initial));
  const dirty = useMemo(() => JSON.stringify(e) !== JSON.stringify(savedSnapshot), [e, savedSnapshot]);

  // Warn on tab close when dirty
  useEffect(() => {
    if (!dirty) return;
    const handler = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const save = async () => {
    await onSave(e);
    // Mark the current edited state as saved — no longer dirty
    setSavedSnapshot(e);
  };

  const reset = () => setE(savedSnapshot);

  return (
    <div
      className={`border p-4 grid grid-cols-1 md:grid-cols-2 gap-3 transition-colors ${dirty ? "border-[var(--scale-gold)] bg-[var(--scale-cream)]/40" : "border-black/10"}`}
      data-testid={`admin-event-row-${index}`}
    >
      {dirty && (
        <div className="md:col-span-2 text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] flex items-center gap-2" data-testid={`row-dirty-${index}`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--scale-crimson)] animate-pulse" />
          Unsaved changes
        </div>
      )}
      <Input value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} />
      <Input value={e.date || ""} onChange={(ev) => setE({ ...e, date: ev.target.value })} placeholder="Date" />
      <Input value={e.location || ""} onChange={(ev) => setE({ ...e, location: ev.target.value })} placeholder="Location" />
      <Input type="number" value={e.price_inr || 0} onChange={(ev) => setE({ ...e, price_inr: parseFloat(ev.target.value || "0") })} placeholder="₹" />
      <Textarea rows={2} className="md:col-span-2" value={e.description || ""} onChange={(ev) => setE({ ...e, description: ev.target.value })} placeholder="Short description" />
      <Textarea rows={4} className="md:col-span-2" value={e.about || ""} onChange={(ev) => setE({ ...e, about: ev.target.value })} placeholder="Long-form about (detail page)" />
      <Textarea rows={2} className="md:col-span-2" value={e.eligibility || ""} onChange={(ev) => setE({ ...e, eligibility: ev.target.value })} placeholder="Eligibility (per-event)" />
      <Select value={e.status} onValueChange={(v) => setE({ ...e, status: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="live">Live</SelectItem>
          <SelectItem value="coming_soon">Coming Soon</SelectItem>
        </SelectContent>
      </Select>
      <Input type="number" value={e.order || 0} onChange={(ev) => setE({ ...e, order: parseInt(ev.target.value || "0", 10) })} placeholder="Order" />
      <Select value={e.registration_mode || "individual"} onValueChange={(v) => setE({ ...e, registration_mode: v })}>
        <SelectTrigger data-testid={`row-mode-${index}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="individual">Individual</SelectItem>
          <SelectItem value="team">Team</SelectItem>
        </SelectContent>
      </Select>
      {e.registration_mode === "team" ? (
        <div className="grid grid-cols-2 gap-3">
          <Input type="number" value={e.team_size_min || 2} onChange={(ev) => setE({ ...e, team_size_min: parseInt(ev.target.value || "2", 10) })} placeholder="Min size" />
          <Input type="number" value={e.team_size_max || 5} onChange={(ev) => setE({ ...e, team_size_max: parseInt(ev.target.value || "5", 10) })} placeholder="Max size" />
        </div>
      ) : <div />}
      <div className="md:col-span-2 flex items-center gap-3 bg-[var(--scale-offwhite)] border border-black/10 px-3 py-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={e.registration_open !== false}
            onChange={(ev) => setE({ ...e, registration_open: ev.target.checked })}
            data-testid={`row-regopen-${index}`}
          />
          Registration open
        </label>
        <span className={`text-[10px] tracking-[0.28em] uppercase font-bold ${e.registration_open !== false ? "text-[var(--scale-crimson)]" : "text-black/50"}`}>
          {e.registration_open !== false ? "● Accepting submissions" : "○ Closed — form hidden on event page"}
        </span>
      </div>
      {e.registration_open === false && (
        <Input
          className="md:col-span-2"
          placeholder="Message shown to visitors when registration is closed"
          value={e.registration_closed_message || ""}
          onChange={(ev) => setE({ ...e, registration_closed_message: ev.target.value })}
          data-testid={`row-closed-msg-${index}`}
        />
      )}
      <div className="md:col-span-2">
        <ExtraFieldsEditor
          value={e.extra_fields || []}
          onChange={(xs) => setE({ ...e, extra_fields: xs })}
          allowMemberScope={e.registration_mode === "team"}
        />
      </div>
      <div className="md:col-span-2 flex gap-2 items-center">
        <button
          onClick={save}
          disabled={!dirty}
          className={`text-sm ${dirty ? "btn-crimson" : "btn-outline-dark opacity-50 cursor-not-allowed"}`}
          data-testid={`row-save-${index}`}
        >
          <Save size={14} /> {dirty ? "Save changes" : "Saved"}
        </button>
        {dirty && (
          <button onClick={reset} className="btn-outline-dark text-sm" data-testid={`row-reset-${index}`}>
            Discard
          </button>
        )}
        <div className="flex-1" />
        <button onClick={() => onRemove(e.id)} className="btn-outline-dark text-sm"><Trash2 size={14} /> Delete</button>
      </div>
      {e.id && <EventHubPanel eventId={e.id} eventTitle={e.title} index={index} />}
    </div>
  );
}

function EventHubPanel({ eventId, eventTitle, index }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("materials"); // materials | submissions
  return (
    <div className="md:col-span-2 border-t border-black/10 pt-3 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] hover:text-[var(--scale-darkred)] flex items-center gap-2"
        data-testid={`hub-toggle-${index}`}
      >
        {open ? "▼" : "▶"} Post-registration hub · materials & submissions
      </button>
      {open && (
        <div className="mt-3 bg-[var(--scale-offwhite)] border border-black/10 p-4">
          <div className="flex items-center gap-2 mb-4 border-b border-black/10 pb-2">
            <button
              onClick={() => setTab("materials")}
              className={`text-xs tracking-widest uppercase font-bold px-2 py-1 ${tab === "materials" ? "text-[var(--scale-crimson)] border-b-2 border-[var(--scale-crimson)]" : "text-black/60"}`}
              data-testid={`hub-tab-materials-${index}`}
            >
              Materials
            </button>
            <button
              onClick={() => setTab("submissions")}
              className={`text-xs tracking-widest uppercase font-bold px-2 py-1 ${tab === "submissions" ? "text-[var(--scale-crimson)] border-b-2 border-[var(--scale-crimson)]" : "text-black/60"}`}
              data-testid={`hub-tab-submissions-${index}`}
            >
              Submissions
            </button>
          </div>
          {tab === "materials" && <MaterialsEditor eventId={eventId} index={index} />}
          {tab === "submissions" && <SubmissionsDashboard eventId={eventId} eventTitle={eventTitle} index={index} />}
        </div>
      )}
    </div>
  );
}

function MaterialsEditor({ eventId, index }) {
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState({ notes: "", links: [], documents: [] });

  const dirty = useMemo(
    () => JSON.stringify({ notes, links, documents }) !== JSON.stringify(snapshot),
    [notes, links, documents, snapshot]
  );

  useEffect(() => {
    (async () => {
      try {
        const m = await eventMaterialsApi.get(eventId);
        setNotes(m.notes || "");
        setLinks(m.links || []);
        setDocuments(m.documents || []);
        setSnapshot({ notes: m.notes || "", links: m.links || [], documents: m.documents || [] });
      } catch {
        toast.error("Failed to load event materials");
      } finally {
        setLoaded(true);
      }
    })();
  }, [eventId]);

  const save = async () => {
    setSaving(true);
    try {
      await eventMaterialsApi.update(eventId, { notes, links, documents });
      setSnapshot({ notes, links, documents });
      toast.success("Materials saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const addLink = () => setLinks([...links, { id: `tmp-${Date.now()}`, label: "", url: "" }]);
  const updateLink = (i, patch) => setLinks(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLink = (i) => setLinks(links.filter((_, idx) => idx !== i));

  const onUpload = async (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    e.target.value = "";
    setUploading(true);
    try {
      const added = [];
      for (const f of list) {
        try {
          const res = await eventMaterialsApi.uploadFile(eventId, f);
          added.push({
            id: `tmp-${Date.now()}-${res.file_id}`,
            label: f.name,
            file_id: res.file_id,
            filename: res.filename,
            content_type: res.content_type,
            size: res.size,
          });
        } catch (err) {
          toast.error(err?.response?.data?.detail || `Upload failed: ${f.name}`);
        }
      }
      if (added.length) setDocuments([...documents, ...added]);
    } finally { setUploading(false); }
  };

  const updateDoc = (i, patch) => setDocuments(documents.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const removeDoc = (i) => setDocuments(documents.filter((_, idx) => idx !== i));

  if (!loaded) return <div className="text-sm text-black/50">Loading materials…</div>;

  return (
    <div className="space-y-5" data-testid={`materials-editor-${index}`}>
      {dirty && (
        <div className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--scale-crimson)] animate-pulse" />
          Unsaved materials changes
        </div>
      )}

      <div>
        <label className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] block mb-1.5">Notes for participants</label>
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Briefing, instructions, or schedule shown to registered participants." data-testid={`materials-notes-${index}`} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)]">Links</span>
          <button type="button" onClick={addLink} className="btn-outline-dark text-xs" data-testid={`materials-add-link-${index}`}><Plus size={12} /> Add link</button>
        </div>
        {links.length === 0 && <div className="text-xs text-black/50">No links yet.</div>}
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 items-center" data-testid={`materials-link-row-${i}`}>
              <Input className="col-span-4" placeholder="Display label (e.g. Zoom Link)" value={l.label} onChange={(e) => updateLink(i, { label: e.target.value })} />
              <Input className="col-span-7" placeholder="https://…" value={l.url} onChange={(e) => updateLink(i, { url: e.target.value })} />
              <button type="button" onClick={() => removeLink(i)} className="col-span-1 text-black/50 hover:text-[var(--scale-crimson)]"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)]">Documents</span>
          <label className="btn-outline-dark text-xs cursor-pointer" data-testid={`materials-upload-${index}`}>
            <Upload size={12} /> {uploading ? "Uploading…" : "Upload files"}
            <input type="file" multiple className="hidden" onChange={onUpload} accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.zip,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mp3,.wav,.m4a" />
          </label>
        </div>
        {documents.length === 0 && <div className="text-xs text-black/50">No documents uploaded yet.</div>}
        <div className="space-y-2">
          {documents.map((d, i) => (
            <div key={d.id || d.file_id} className="grid grid-cols-12 gap-2 items-center bg-white border border-black/10 p-2" data-testid={`materials-doc-row-${i}`}>
              <FileText size={16} className="col-span-1 text-[var(--scale-crimson)]" />
              <Input className="col-span-4" placeholder="Display label" value={d.label || ""} onChange={(e) => updateDoc(i, { label: e.target.value })} />
              <div className="col-span-5 text-xs text-black/55 truncate">{d.filename} · {formatBytes(d.size)}</div>
              <a href={eventMaterialsApi.downloadUrl(eventId, d.file_id)} target="_blank" rel="noreferrer" className="col-span-1 text-black/50 hover:text-[var(--scale-crimson)] text-xs"><Download size={14} /></a>
              <button type="button" onClick={() => removeDoc(i)} className="col-span-1 text-black/50 hover:text-[var(--scale-crimson)]"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2 border-t border-black/10">
        <button onClick={save} disabled={!dirty || saving} className={`text-sm ${dirty ? "btn-crimson" : "btn-outline-dark opacity-50"}`} data-testid={`materials-save-${index}`}>
          <Save size={14} /> {saving ? "Saving…" : dirty ? "Save materials" : "Saved"}
        </button>
      </div>
    </div>
  );
}

function SubmissionsDashboard({ eventId, eventTitle, index }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true);
    try { setSubs(await eventSubmissionsApi.adminList(eventId)); }
    catch { toast.error("Failed to load submissions"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventId]);

  const exportCsv = async () => {
    try {
      const token = localStorage.getItem("scale_token");
      const res = await fetch(eventSubmissionsApi.exportUrl(eventId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `submissions-${(eventTitle || eventId).replace(/\s+/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  if (loading) return <div className="text-sm text-black/50">Loading submissions…</div>;
  if (subs.length === 0) return <div className="text-sm text-black/50 italic">No submissions yet.</div>;

  return (
    <div data-testid={`submissions-dashboard-${index}`}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs text-black/60">{subs.length} submission{subs.length === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-outline-dark text-xs"><RefreshCw size={12} /> Reload</button>
          <button onClick={exportCsv} className="btn-crimson text-xs" data-testid={`submissions-export-${index}`}><Download size={12} /> Export CSV</button>
        </div>
      </div>
      <div className="space-y-2">
        {subs.map((s) => (
          <div key={s.id} className="bg-white border border-black/10" data-testid={`submission-row-${s.id}`}>
            <button
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              className="w-full text-left p-3 flex items-center gap-3 hover:bg-[var(--scale-cream)]/30"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{s.student_name} <span className="text-xs text-black/50 font-normal">· {s.student_email}</span></div>
                <div className="text-xs text-black/55 truncate">{s.student_school} · {(s.files || []).length} file{(s.files || []).length === 1 ? "" : "s"} · Updated {new Date(s.updated_at).toLocaleString()}</div>
              </div>
              <span className="text-xs text-black/40">{expanded === s.id ? "▼" : "▶"}</span>
            </button>
            {expanded === s.id && (
              <div className="p-4 border-t border-black/10 bg-[var(--scale-offwhite)] space-y-3">
                <div>
                  <div className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] mb-1">Response</div>
                  <div className="whitespace-pre-line text-sm text-black/80">{s.text_response || <em className="text-black/45">(no text)</em>}</div>
                </div>
                {(s.files || []).length > 0 && (
                  <div>
                    <div className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] mb-1">Attachments</div>
                    <div className="space-y-1">
                      {s.files.map((f) => (
                        <button
                          key={f.file_id}
                          onClick={() => downloadAdminFile(f.file_id, f.filename)}
                          className="flex items-center gap-2 text-sm text-[var(--scale-crimson)] hover:underline"
                          data-testid={`submission-file-dl-${f.file_id}`}
                        >
                          <Download size={14} /> {f.filename} <span className="text-xs text-black/40">· {formatBytes(f.size)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBytes(n = 0) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadAdminFile(fileId, filename) {
  try {
    const token = localStorage.getItem("scale_token");
    const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "file";
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Download failed");
  }
}

function ExtraFieldsEditor({ value, onChange, allowMemberScope = false }) {
  const items = value || [];
  const add = () => onChange([
    ...items,
    { key: `q_${items.length + 1}`, label: "", type: "text", required: false, options: [], scope: "team", help_text: "" },
  ]);
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const arr = [...items];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  return (
    <div className="bg-[var(--scale-offwhite)] border border-black/10 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)]">Extra form questions</div>
        <button type="button" onClick={add} className="btn-outline-dark text-xs" data-testid="add-extra-field"><Plus size={12} /> Add question</button>
      </div>
      {items.length === 0 && <div className="text-xs text-black/60">No extra questions. Add ones you want to ask on this event's form.</div>}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="bg-white border border-black/10 p-3 grid grid-cols-1 md:grid-cols-12 gap-2" data-testid={`extra-row-${i}`}>
            <Input className="md:col-span-3" placeholder="Key (no spaces)" value={it.key} onChange={(e) => update(i, { key: e.target.value.replace(/\s+/g, "_") })} />
            <Input className="md:col-span-4" placeholder="Question shown to student" value={it.label} onChange={(e) => update(i, { label: e.target.value })} />
            <Select value={it.type} onValueChange={(v) => update(i, { type: v })}>
              <SelectTrigger className="md:col-span-2" data-testid={`extra-type-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Short text</SelectItem>
                <SelectItem value="textarea">Long text</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="yesno">Yes / No</SelectItem>
                <SelectItem value="select">Dropdown</SelectItem>
                <SelectItem value="radio">Radio buttons</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
                <SelectItem value="file">File upload</SelectItem>
              </SelectContent>
            </Select>
            <label className="md:col-span-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!it.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Required
            </label>
            <div className="md:col-span-1 flex items-center gap-1 justify-end">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-black/40 hover:text-black disabled:opacity-30" title="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-black/40 hover:text-black disabled:opacity-30" title="Move down">↓</button>
              <button type="button" onClick={() => remove(i)} className="text-black/50 hover:text-[var(--scale-crimson)]" data-testid={`extra-remove-${i}`}><Trash2 size={14} /></button>
            </div>
            {(it.type === "select" || it.type === "radio") && (
              <Input
                className="md:col-span-12"
                placeholder="Options (comma-separated)"
                value={(it.options || []).join(", ")}
                onChange={(e) => update(i, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                data-testid={`extra-options-${i}`}
              />
            )}
            <Input
              className="md:col-span-12"
              placeholder="Help text (optional, shown below the question)"
              value={it.help_text || ""}
              onChange={(e) => update(i, { help_text: e.target.value })}
            />
            {allowMemberScope && (
              <div className="md:col-span-12 flex items-center gap-3 text-xs bg-[var(--scale-offwhite)] px-3 py-2 border border-black/10">
                <span className="font-semibold uppercase tracking-wider text-black/70">Ask</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name={`scope-${i}`} checked={(it.scope || "team") === "team"} onChange={() => update(i, { scope: "team" })} />
                  Once per team (captain answers)
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name={`scope-${i}`} checked={it.scope === "member"} onChange={() => update(i, { scope: "member" })} />
                  Each team member individually
                </label>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionsAdmin({ sessions, reload }) {
  const empty = { topic: "", speaker: "", date: "", description: "", order: sessions.length + 1 };
  const [draft, setDraft] = useState(empty);
  const add = async () => {
    if (!draft.topic) return toast.error("Topic required");
    await sessionsApi.create(draft);
    setDraft({ ...empty, order: sessions.length + 2 });
    reload();
  };
  return (
    <div className="bg-white p-6 border border-black/10">
      <h2 className="font-serif font-bold text-2xl mb-4">Sessions</h2>
      <div className="space-y-3">
        {sessions.map((s, idx) => <SessionRow key={s.id} initial={s} idx={idx} reload={reload} />)}
      </div>
      <div className="mt-6 border-t pt-6">
        <h3 className="font-serif font-bold text-lg mb-3">Add session</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="Topic" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
          <Input placeholder="Speaker" value={draft.speaker} onChange={(e) => setDraft({ ...draft, speaker: e.target.value })} />
          <Input placeholder="Date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <Input type="number" placeholder="Order" value={draft.order} onChange={(e) => setDraft({ ...draft, order: parseInt(e.target.value || "0", 10) })} />
        </div>
        <button onClick={add} className="btn-crimson text-sm mt-3"><Plus size={14} /> Add session</button>
      </div>
    </div>
  );
}

function SessionRow({ initial, idx, reload }) {
  const [s, setS] = useState(initial);
  const save = async () => { await sessionsApi.update(s.id, s); toast.success("Saved."); reload(); };
  const remove = async () => { if (window.confirm("Delete?")) { await sessionsApi.remove(s.id); reload(); } };
  return (
    <div className="border border-black/10 p-4 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`admin-session-row-${idx}`}>
      <Input value={s.topic} onChange={(e) => setS({ ...s, topic: e.target.value })} />
      <Input value={s.speaker} onChange={(e) => setS({ ...s, speaker: e.target.value })} />
      <Input value={s.date} onChange={(e) => setS({ ...s, date: e.target.value })} />
      <Input type="number" value={s.order || 0} onChange={(e) => setS({ ...s, order: parseInt(e.target.value || "0", 10) })} />
      <div className="md:col-span-2 flex gap-2">
        <button onClick={save} className="btn-crimson text-sm"><Save size={14} /> Save</button>
        <button onClick={remove} className="btn-outline-dark text-sm"><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function ImageUploadField({ label, url, onUploaded, testId }) {
  const [uploading, setUploading] = useState(false);
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploading(true);
    try {
      const res = await uploadsApi.image(f);
      onUploaded(uploadsApi.imageUrl(res.id));
    } catch { toast.error("Image upload failed."); }
    finally { setUploading(false); }
  };
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider font-semibold text-black/70">{label}</Label>
      <div className="mt-1.5 flex items-center gap-3">
        {url ? (
          <img src={url} alt="" className="h-16 w-16 object-cover border border-black/10" />
        ) : (
          <div className="h-16 w-16 bg-black/5 flex items-center justify-center text-[10px] text-black/40 border border-black/10">No image</div>
        )}
        <label className="btn-outline-dark text-xs cursor-pointer" data-testid={testId}>
          <Upload size={12} /> {uploading ? "Uploading…" : "Upload"}
          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}

function CommunityAdmin({ community, reload }) {
  const empty = { name: "", type: "school", image_url: "", attendance_count: 0, subject: "", mentor_name: "", order: community.length + 1 };
  const [draft, setDraft] = useState(empty);
  const add = async () => {
    if (!draft.name) return toast.error("Name required");
    await communityApi.create(draft);
    toast.success("Added.");
    setDraft({ ...empty, order: community.length + 2 });
    reload();
  };
  return (
    <div className="bg-white p-6 border border-black/10">
      <h2 className="font-serif font-bold text-2xl mb-4">Community — Schools &amp; NGOs</h2>
      <div className="space-y-4">
        {community.map((g, idx) => <CommunityRow key={g.id} initial={g} index={idx} reload={reload} />)}
      </div>
      <div className="mt-8 border-t pt-6">
        <h3 className="font-serif font-bold text-lg mb-3">Add school / NGO</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="new-community-name" />
          <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="school">School</SelectItem>
              <SelectItem value="ngo">NGO</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Attendance count" value={draft.attendance_count} onChange={(e) => setDraft({ ...draft, attendance_count: parseInt(e.target.value || "0", 10) })} />
          <Input placeholder="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <Input placeholder="Mentor name" value={draft.mentor_name} onChange={(e) => setDraft({ ...draft, mentor_name: e.target.value })} />
          <Input type="number" placeholder="Order" value={draft.order} onChange={(e) => setDraft({ ...draft, order: parseInt(e.target.value || "0", 10) })} />
        </div>
        <button onClick={add} className="btn-crimson text-sm mt-3" data-testid="add-community-btn"><Plus size={14} /> Add</button>
      </div>
    </div>
  );
}

function CommunityRow({ initial, index, reload }) {
  const [g, setG] = useState(initial);
  const save = async () => { await communityApi.update(g.id, g); toast.success("Saved."); reload(); };
  const remove = async () => { if (window.confirm("Delete this school/NGO?")) { await communityApi.remove(g.id); reload(); } };

  const addGalleryImage = (url) => setG({ ...g, gallery: [...(g.gallery || []), { id: `tmp-${Date.now()}`, url, caption: "" }] });
  const removeGalleryImage = (imgId) => setG({ ...g, gallery: (g.gallery || []).filter((im) => im.id !== imgId) });

  return (
    <div className="border border-black/10 p-4 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`admin-community-row-${index}`}>
      <Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Name" />
      <Select value={g.type} onValueChange={(v) => setG({ ...g, type: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="school">School</SelectItem>
          <SelectItem value="ngo">NGO</SelectItem>
        </SelectContent>
      </Select>
      <Input type="number" value={g.attendance_count || 0} onChange={(e) => setG({ ...g, attendance_count: parseInt(e.target.value || "0", 10) })} placeholder="Attendance count" />
      <Input value={g.subject || ""} onChange={(e) => setG({ ...g, subject: e.target.value })} placeholder="Subject" />
      <Input value={g.mentor_name || ""} onChange={(e) => setG({ ...g, mentor_name: e.target.value })} placeholder="Mentor name" />
      <Input type="number" value={g.order || 0} onChange={(e) => setG({ ...g, order: parseInt(e.target.value || "0", 10) })} placeholder="Order" />

      <div className="md:col-span-2">
        <ImageUploadField label="Main image" url={g.image_url} onUploaded={(url) => setG({ ...g, image_url: url })} testId={`community-image-upload-${index}`} />
      </div>

      <div className="md:col-span-2 flex items-center gap-3 bg-[var(--scale-offwhite)] border border-black/10 px-3 py-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={g.show_para !== false} onChange={(e) => setG({ ...g, show_para: e.target.checked })} data-testid={`community-showpara-${index}`} />
          Show "additional info" paragraph
        </label>
      </div>
      {g.show_para !== false && (
        <Textarea className="md:col-span-2" rows={3} value={g.para || ""} onChange={(e) => setG({ ...g, para: e.target.value })} placeholder="Additional info paragraph" />
      )}

      <div className="md:col-span-2 flex items-center gap-3 bg-[var(--scale-offwhite)] border border-black/10 px-3 py-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={g.show_impact !== false} onChange={(e) => setG({ ...g, show_impact: e.target.checked })} data-testid={`community-showimpact-${index}`} />
          Show impact percentage (admin-only editable)
        </label>
      </div>
      {g.show_impact !== false && (
        <div className="md:col-span-2" data-testid={`community-impact-slider-${index}`}>
          <div className="text-[11px] text-black/40 mb-1">(percentage of students that passed the final test)</div>
          <Slider value={[g.impact_percentage || 0]} max={100} step={1} onValueChange={([v]) => setG({ ...g, impact_percentage: v })} />
          <div className="text-xs text-black/50 mt-1">{g.impact_percentage || 0}% impact</div>
        </div>
      )}

      <div className="md:col-span-2">
        <Label className="text-xs uppercase tracking-wider font-semibold text-black/70">Gallery images</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {(g.gallery || []).map((img) => (
            <div key={img.id} className="relative h-16 w-16">
              <img src={img.url} alt="" className="h-16 w-16 object-cover border border-black/10" />
              <button onClick={() => removeGalleryImage(img.id)} className="absolute -top-1.5 -right-1.5 bg-black/70 text-white p-0.5 rounded-full" title="Remove">
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          <ImageUploadField label="" url="" onUploaded={addGalleryImage} testId={`community-gallery-upload-${index}`} />
        </div>
      </div>

      <div className="md:col-span-2 flex gap-2">
        <button onClick={save} className="btn-crimson text-sm" data-testid={`community-save-${index}`}><Save size={14} /> Save</button>
        <button onClick={remove} className="btn-outline-dark text-sm" data-testid={`community-delete-${index}`}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function TeamAdmin({ members, reload }) {
  const empty = { name: "", designation: "", image_url: "", bio: "", order: members.length + 1 };
  const [draft, setDraft] = useState(empty);
  const add = async () => {
    if (!draft.name) return toast.error("Name required");
    await teamApi.create(draft);
    toast.success("Added.");
    setDraft({ ...empty, order: members.length + 2 });
    reload();
  };
  return (
    <div className="bg-white p-6 border border-black/10">
      <h2 className="font-serif font-bold text-2xl mb-4">Our Team</h2>
      <div className="space-y-4">
        {members.map((m, idx) => <TeamRow key={m.id} initial={m} index={idx} reload={reload} />)}
      </div>
      <div className="mt-8 border-t pt-6">
        <h3 className="font-serif font-bold text-lg mb-3">Add team member</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="new-team-name" />
          <Input placeholder="Designation" value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} />
          <Textarea className="md:col-span-2" rows={2} placeholder="Short bio" value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
          <Input type="number" placeholder="Order" value={draft.order} onChange={(e) => setDraft({ ...draft, order: parseInt(e.target.value || "0", 10) })} />
        </div>
        <button onClick={add} className="btn-crimson text-sm mt-3" data-testid="add-team-btn"><Plus size={14} /> Add</button>
      </div>
    </div>
  );
}

function TeamRow({ initial, index, reload }) {
  const [m, setM] = useState(initial);
  const save = async () => { await teamApi.update(m.id, m); toast.success("Saved."); reload(); };
  const remove = async () => { if (window.confirm("Remove this team member?")) { await teamApi.remove(m.id); reload(); } };
  return (
    <div className="border border-black/10 p-4 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid={`admin-team-row-${index}`}>
      <Input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Name" />
      <Input value={m.designation || ""} onChange={(e) => setM({ ...m, designation: e.target.value })} placeholder="Designation" />
      <Textarea className="md:col-span-2" rows={2} value={m.bio || ""} onChange={(e) => setM({ ...m, bio: e.target.value })} placeholder="Short bio" />
      <Input type="number" value={m.order || 0} onChange={(e) => setM({ ...m, order: parseInt(e.target.value || "0", 10) })} placeholder="Order" />
      <div className="md:col-span-2">
        <ImageUploadField label="Profile image" url={m.image_url} onUploaded={(url) => setM({ ...m, image_url: url })} testId={`team-image-upload-${index}`} />
      </div>
      <div className="md:col-span-2 flex gap-2">
        <button onClick={save} className="btn-crimson text-sm" data-testid={`team-save-${index}`}><Save size={14} /> Save</button>
        <button onClick={remove} className="btn-outline-dark text-sm" data-testid={`team-delete-${index}`}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function RegistrationsAdmin({ registrations }) {
  return (
    <div className="bg-white p-6 border border-black/10">
      <h2 className="font-serif font-bold text-2xl mb-4">Event Registrations</h2>
      {registrations.length === 0 && <div className="text-sm text-black/60">No registrations yet.</div>}
      <div className="space-y-3">
        {registrations.map((r) => (
          <div key={r.id} className="border border-black/10 p-4 grid grid-cols-1 md:grid-cols-3 gap-3" data-testid={`reg-row-${r.id}`}>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--scale-crimson)]">{r.event_title}</div>
              <div className="font-serif font-bold mt-1">{r.name} · {r.grade}</div>
              <div className="text-xs text-black/60">{r.school}</div>
            </div>
            <div className="text-sm">
              <div><span className="text-black/50">Email:</span> {r.email}</div>
              <div><span className="text-black/50">Phone:</span> {r.phone}</div>
              <div className="mt-2"><span className="text-black/50">Parent:</span> {r.parent_name}</div>
              <div><span className="text-black/50">P.email:</span> {r.parent_email}</div>
            </div>
            <div className="text-right">
              <div className={`inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                r.payment_status === "paid"
                  ? "bg-[var(--scale-cream)] text-[var(--scale-crimson)] border border-[var(--scale-crimson)]"
                  : "bg-black/5 text-black/70"
              }`}>
                {r.payment_status === "paid" ? "PAID ✓" : "Pending"}
              </div>
              <div className="text-[11px] text-black/40 mt-2">₹{Math.round(r.amount_inr || 500)}</div>
              <div className="text-[10px] text-black/40 mt-1">{new Date(r.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubmissionsAdmin({ submissions, reload }) {
  const [filter, setFilter] = useState("all");
  const remove = async (id) => { if (!window.confirm("Delete?")) return; await submissionsApi.remove(id); reload(); };
  const visible = filter === "all" ? submissions : submissions.filter((s) => s.type === filter);

  const token = typeof window !== "undefined" ? localStorage.getItem("scale_token") : null;
  const apiBase = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
  const downloadFile = async (fileId) => {
    try {
      const resp = await fetch(`${apiBase}/admin/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) { toast.error("Download failed."); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast.error("Download failed."); }
  };

  return (
    <div className="bg-white p-6 border border-black/10">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-serif font-bold text-2xl">Form submissions</h2>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="contact">Contact</SelectItem>
            <SelectItem value="registration">Registrations</SelectItem>
            <SelectItem value="event_scholarship">Event scholarships</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {visible.length === 0 && <div className="text-sm text-black/60">No submissions yet.</div>}
      <div className="space-y-3">
        {visible.map((s) => {
          const fileId = s?.data?.proof_file_id;
          return (
            <div key={s.id} className="border border-black/10 p-4" data-testid={`submission-${s.id}`}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)]">{s.type}</span>
                  <span className="text-xs text-black/50">{new Date(s.created_at).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  {fileId && (
                    <button
                      onClick={() => downloadFile(fileId)}
                      className="btn-outline-dark text-xs"
                      data-testid={`download-proof-${s.id}`}
                    >
                      View proof file
                    </button>
                  )}
                  <button onClick={() => remove(s.id)} className="text-black/40 hover:text-[var(--scale-crimson)]"><Trash2 size={14} /></button>
                </div>
              </div>
              <pre className="text-xs bg-[var(--scale-offwhite)] p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(s.data, null, 2)}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PagesAdmin({ pages, reload }) {
  const [draft, setDraft] = useState({ slug: "", title: "", nav_label: "", show_in_nav: true, published: true });
  const [editing, setEditing] = useState(null); // page being edited (full object)

  const create = async () => {
    if (!draft.slug || !draft.title) return toast.error("Slug and title required");
    try {
      const newPage = await pagesApi.create({ ...draft, blocks: [], order: pages.length });
      setDraft({ slug: "", title: "", nav_label: "", show_in_nav: true, published: true });
      await reload();
      setEditing(newPage);
      toast.success("Page created. Add content blocks below.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Create failed");
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete page '${p.title}'? This cannot be undone.`)) return;
    await pagesApi.remove(p.id);
    await reload();
    toast.success("Page deleted");
    if (editing?.id === p.id) setEditing(null);
  };

  if (editing) {
    return (
      <PageEditor
        page={editing}
        onClose={async () => { setEditing(null); await reload(); }}
        onChange={(updated) => setEditing(updated)}
      />
    );
  }

  return (
    <div className="bg-white p-6 border border-black/10" data-testid="pages-admin">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-serif font-bold text-2xl">Custom Pages</h2>
        <span className="text-xs text-black/60">{pages.length} page{pages.length === 1 ? "" : "s"}</span>
      </div>
      <p className="text-sm text-black/60 mb-5">Add stand-alone pages (e.g. SCALE+, FAQ, Mentors) that appear in the site navigation. Each page is built from content blocks and is fully admin-editable.</p>

      <div className="space-y-3">
        {pages.length === 0 && <div className="text-sm text-black/50 italic">No custom pages yet. Add one below.</div>}
        {pages.map((p) => (
          <div key={p.id} className="border border-black/10 p-4 flex items-start justify-between gap-4 flex-wrap" data-testid={`page-row-${p.slug}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-serif font-bold text-lg">{p.title}</span>
                <span className="text-xs text-black/50 font-mono">/p/{p.slug}</span>
                {!p.published && <span className="text-[10px] tracking-[0.2em] uppercase font-bold bg-black/10 text-black/70 px-2 py-0.5">Draft</span>}
                {p.show_in_nav && p.published && <span className="text-[10px] tracking-[0.2em] uppercase font-bold bg-[var(--scale-cream)] text-[var(--scale-crimson)] px-2 py-0.5">In nav</span>}
              </div>
              <div className="text-xs text-black/60 mt-1">{(p.blocks || []).length} block{(p.blocks || []).length === 1 ? "" : "s"} · Updated {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}</div>
            </div>
            <div className="flex gap-2">
              <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="btn-outline-dark text-xs"><ExternalLink size={12} /> View</a>
              <button onClick={() => setEditing(p)} className="btn-crimson text-xs" data-testid={`page-edit-${p.slug}`}>Edit</button>
              <button onClick={() => remove(p)} className="btn-outline-dark text-xs" data-testid={`page-delete-${p.slug}`}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 border-t pt-6">
        <h3 className="font-serif font-bold text-lg mb-3">Add new page</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            placeholder="Title (e.g. SCALE+)"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value, nav_label: draft.nav_label || e.target.value, slug: draft.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })}
            data-testid="new-page-title"
          />
          <Input
            placeholder="URL slug (e.g. scale-plus)"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
            data-testid="new-page-slug"
          />
          <Input
            placeholder="Navbar label (defaults to title)"
            value={draft.nav_label}
            onChange={(e) => setDraft({ ...draft, nav_label: e.target.value })}
            data-testid="new-page-nav-label"
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.show_in_nav} onChange={(e) => setDraft({ ...draft, show_in_nav: e.target.checked })} />
              Show in navigation
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
              Published
            </label>
          </div>
        </div>
        <button onClick={create} className="btn-crimson text-sm mt-3" data-testid="add-page-btn"><Plus size={14} /> Create page</button>
      </div>
    </div>
  );
}

const BLOCK_DEFAULTS = {
  hero: { eyebrow: "", headline: "", subtext: "", cta_label: "", cta_link: "" },
  section: { eyebrow: "", headline: "", body: "" },
  cards: { eyebrow: "", headline: "", items: [{ title: "", desc: "" }] },
  cta: { headline: "", subtext: "", cta_label: "", cta_link: "" },
  image: { url: "", alt: "", caption: "" },
  richtext: { body: "" },
};

function PageEditor({ page, onClose, onChange }) {
  const { refreshPages } = useApp();
  const [meta, setMeta] = useState({
    slug: page.slug, title: page.title, nav_label: page.nav_label || "",
    show_in_nav: page.show_in_nav !== false, published: page.published !== false, order: page.order || 0,
  });
  const [blocks, setBlocks] = useState(page.blocks || []);
  const [saving, setSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState({ meta, blocks });

  const dirty = useMemo(
    () => JSON.stringify({ meta, blocks }) !== JSON.stringify(savedSnapshot),
    [meta, blocks, savedSnapshot]
  );

  const addBlock = (type) => {
    const newBlock = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`, type, props: { ...BLOCK_DEFAULTS[type] } };
    setBlocks([...blocks, newBlock]);
  };
  const updateBlock = (idx, patch) => setBlocks(blocks.map((b, i) => (i === idx ? { ...b, ...patch, props: { ...b.props, ...(patch.props || {}) } } : b)));
  const removeBlock = (idx) => setBlocks(blocks.filter((_, i) => i !== idx));
  const moveBlock = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const arr = [...blocks];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setBlocks(arr);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await pagesApi.update(page.id, { ...meta, blocks });
      onChange(updated);
      setSavedSnapshot({ meta, blocks });
      // Push the change to the global pages cache so the public navbar
      // updates immediately (e.g. when admin unticks `show_in_nav`).
      await refreshPages();
      toast.success("Page saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-black/10 p-6" data-testid="page-editor">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <button onClick={onClose} className="text-xs text-black/60 hover:text-black mb-1">← Back to Pages</button>
          <h2 className="font-serif font-bold text-2xl">Editing: {meta.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/p/${meta.slug}`} target="_blank" rel="noreferrer" className="btn-outline-dark text-xs"><ExternalLink size={12} /> Preview</a>
          <button onClick={save} disabled={saving || !dirty} className={`text-sm ${dirty ? "btn-crimson" : "btn-outline-dark opacity-50"}`} data-testid="page-save-btn">
            <Save size={14} /> {saving ? "Saving…" : (dirty ? "Save" : "Saved")}
          </button>
        </div>
      </div>

      {dirty && (
        <div className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)] flex items-center gap-2 mb-3">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--scale-crimson)] animate-pulse" />
          Unsaved changes
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 bg-[var(--scale-offwhite)] p-4 border border-black/10">
        <F label="Title"><Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></F>
        <F label="Slug (URL)"><Input value={meta.slug} onChange={(e) => setMeta({ ...meta, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></F>
        <F label="Nav label"><Input value={meta.nav_label} onChange={(e) => setMeta({ ...meta, nav_label: e.target.value })} placeholder={meta.title} /></F>
        <F label="Order"><Input type="number" value={meta.order} onChange={(e) => setMeta({ ...meta, order: parseInt(e.target.value || "0", 10) })} /></F>
        <div className="md:col-span-2 flex items-center gap-5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={meta.show_in_nav} onChange={(e) => setMeta({ ...meta, show_in_nav: e.target.checked })} data-testid="page-show-in-nav" />
            Show in navigation
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={meta.published} onChange={(e) => setMeta({ ...meta, published: e.target.checked })} data-testid="page-published" />
            Published (visible to public)
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif font-bold text-lg">Content blocks</h3>
        <div className="flex flex-wrap gap-1">
          {Object.keys(BLOCK_DEFAULTS).map((t) => (
            <button key={t} onClick={() => addBlock(t)} className="btn-outline-dark text-xs capitalize" data-testid={`add-block-${t}`}>
              <Plus size={12} /> {t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {blocks.length === 0 && <div className="text-sm text-black/50 italic border border-dashed border-black/20 p-6 text-center">No blocks yet. Add one above.</div>}
        {blocks.map((b, i) => (
          <BlockEditor
            key={b.id}
            block={b}
            index={i}
            onUpdate={(patch) => updateBlock(i, patch)}
            onRemove={() => removeBlock(i)}
            onMoveUp={i > 0 ? () => moveBlock(i, -1) : null}
            onMoveDown={i < blocks.length - 1 ? () => moveBlock(i, 1) : null}
          />
        ))}
      </div>
    </div>
  );
}

function BlockEditor({ block, index, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  const p = block.props || {};
  const set = (k, v) => onUpdate({ props: { [k]: v } });
  return (
    <div className="border border-black/10 bg-white p-4" data-testid={`block-editor-${index}`}>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-black/10">
        <span className="text-[10px] tracking-[0.28em] uppercase font-bold text-[var(--scale-crimson)]">Block {index + 1} · {block.type}</span>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={!onMoveUp} className="text-black/40 hover:text-black disabled:opacity-30" title="Move up">↑</button>
          <button onClick={onMoveDown} disabled={!onMoveDown} className="text-black/40 hover:text-black disabled:opacity-30" title="Move down">↓</button>
          <button onClick={onRemove} className="text-black/50 hover:text-[var(--scale-crimson)] ml-2" data-testid={`block-remove-${index}`}><Trash2 size={14} /></button>
        </div>
      </div>
      {block.type === "hero" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <F label="Eyebrow"><Input value={p.eyebrow || ""} onChange={(e) => set("eyebrow", e.target.value)} /></F>
          <F label="CTA label"><Input value={p.cta_label || ""} onChange={(e) => set("cta_label", e.target.value)} /></F>
          <F label="Headline" full><Textarea rows={2} value={p.headline || ""} onChange={(e) => set("headline", e.target.value)} /></F>
          <F label="Subtext" full><Textarea rows={3} value={p.subtext || ""} onChange={(e) => set("subtext", e.target.value)} /></F>
          <F label="CTA link"><Input value={p.cta_link || ""} onChange={(e) => set("cta_link", e.target.value)} placeholder="/contact or https://…" /></F>
        </div>
      )}
      {block.type === "section" && (
        <div className="grid grid-cols-1 gap-3">
          <F label="Eyebrow"><Input value={p.eyebrow || ""} onChange={(e) => set("eyebrow", e.target.value)} /></F>
          <F label="Headline"><Textarea rows={2} value={p.headline || ""} onChange={(e) => set("headline", e.target.value)} /></F>
          <F label="Body"><Textarea rows={5} value={p.body || ""} onChange={(e) => set("body", e.target.value)} /></F>
        </div>
      )}
      {block.type === "cards" && (
        <CardsEditor props={p} setProp={set} />
      )}
      {block.type === "cta" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <F label="Headline" full><Textarea rows={2} value={p.headline || ""} onChange={(e) => set("headline", e.target.value)} /></F>
          <F label="Subtext" full><Textarea rows={2} value={p.subtext || ""} onChange={(e) => set("subtext", e.target.value)} /></F>
          <F label="CTA label"><Input value={p.cta_label || ""} onChange={(e) => set("cta_label", e.target.value)} /></F>
          <F label="CTA link"><Input value={p.cta_link || ""} onChange={(e) => set("cta_link", e.target.value)} placeholder="/contact" /></F>
        </div>
      )}
      {block.type === "image" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <F label="Image URL" full><Input value={p.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></F>
          <F label="Alt text"><Input value={p.alt || ""} onChange={(e) => set("alt", e.target.value)} /></F>
          <F label="Caption"><Input value={p.caption || ""} onChange={(e) => set("caption", e.target.value)} /></F>
        </div>
      )}
      {block.type === "richtext" && (
        <Textarea rows={8} value={p.body || ""} onChange={(e) => set("body", e.target.value)} placeholder="Long-form text. Line breaks preserved." />
      )}
    </div>
  );
}

function CardsEditor({ props, setProp }) {
  const items = props.items || [];
  const update = (i, patch) => setProp("items", items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => setProp("items", [...items, { title: "", desc: "" }]);
  const remove = (i) => setProp("items", items.filter((_, idx) => idx !== i));
  return (
    <div className="grid grid-cols-1 gap-3">
      <F label="Eyebrow"><Input value={props.eyebrow || ""} onChange={(e) => setProp("eyebrow", e.target.value)} /></F>
      <F label="Headline"><Input value={props.headline || ""} onChange={(e) => setProp("headline", e.target.value)} /></F>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="border border-black/10 p-3 grid grid-cols-1 md:grid-cols-12 gap-2">
            <Input className="md:col-span-4" placeholder="Card title" value={it.title} onChange={(e) => update(i, { title: e.target.value })} />
            <Textarea className="md:col-span-7" rows={2} placeholder="Description" value={it.desc} onChange={(e) => update(i, { desc: e.target.value })} />
            <button onClick={() => remove(i)} className="md:col-span-1 text-black/50 hover:text-[var(--scale-crimson)]"><Trash2 size={14} /></button>
          </div>
        ))}
        <button onClick={add} className="btn-outline-dark text-xs"><Plus size={12} /> Add card</button>
      </div>
    </div>
  );
}
