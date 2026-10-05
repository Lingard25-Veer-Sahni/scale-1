import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { teamApi, uploadsApi } from "../lib/api";
import Editable from "../components/Editable";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

export default function TeamPage() {
  const { content, editing, isAdmin, loading: appLoading } = useApp();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    try { setMembers(await teamApi.list()); } catch { toast.error("Failed to load team."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Admins can still reach the page (to review/un-hide it); everyone else is
  // bounced home once we know the page has been hidden via the Content tab.
  if (!appLoading && content && content.team_page_visible === false && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const selected = members.find((m) => m.id === openId) || null;

  const patch = async (id, fields) => {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...fields } : m)));
    try { await teamApi.update(id, fields); } catch { toast.error("Update failed."); }
  };

  const addMember = async () => {
    try {
      const m = await teamApi.create({ name: "New Member", designation: "Team Member", order: members.length + 1 });
      setMembers((ms) => [...ms, m]);
      setOpenId(m.id);
      toast.success("Added. Fill in the details.");
    } catch { toast.error("Add failed."); }
  };

  const removeMember = async (id) => {
    if (!window.confirm("Remove this team member?")) return;
    setMembers((ms) => ms.filter((m) => m.id !== id));
    if (openId === id) setOpenId(null);
    try { await teamApi.remove(id); toast.success("Removed."); } catch { toast.error("Remove failed."); }
  };

  const uploadImage = async (id, file) => {
    try {
      const res = await uploadsApi.image(file);
      await patch(id, { image_url: uploadsApi.imageUrl(res.id) });
    } catch { toast.error("Image upload failed."); }
  };

  return (
    <div className="min-h-screen bg-[var(--scale-offwhite)] pt-20" data-testid="team-page">
      <section className="dark-red-section py-12 md:py-20">
        <div className="max-container">
          <Editable as="div" field="team_eyebrow" value={content?.team_eyebrow} className="eyebrow-gold block" />
          <Editable
            as="h1"
            field="team_headline"
            value={content?.team_headline}
            multiline
            className="font-serif font-black text-4xl md:text-6xl text-white leading-[1.05] block mt-2"
          />
          <Editable
            as="p"
            field="team_about"
            value={content?.team_about}
            multiline
            className="mt-6 max-w-2xl text-white/80 leading-relaxed block"
          />
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="max-container">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
            <h2 className="font-serif font-black text-2xl md:text-3xl">The Team</h2>
            {editing && (
              <button onClick={addMember} className="btn-outline-dark text-xs" data-testid="add-team-member">
                <Plus size={14} /> Add member
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-black/50">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-black/50 border border-dashed border-black/15 p-10 text-center">
              No team members added yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="relative border border-black/15 bg-white cursor-pointer hover:border-[var(--scale-crimson)] transition-colors"
                  data-testid={`team-card-${m.id}`}
                  onClick={() => setOpenId(m.id)}
                >
                  {editing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeMember(m.id); }}
                      className="absolute top-2 right-2 z-10 bg-black/70 text-white p-1 rounded-full"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <div className="aspect-square bg-black/5 overflow-hidden">
                    {m.image_url ? (
                      <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-black/30 text-xs">No image</div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-serif font-black text-lg" data-testid={`team-name-${m.id}`}>{m.name || "Untitled"}</h3>
                    <div className="mt-1 inline-block text-[10px] tracking-[0.2em] uppercase font-bold text-[var(--scale-crimson)]">
                      {m.designation || "Team Member"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0" data-testid="team-detail-dialog">
          {selected && (
            <TeamDetail
              member={selected}
              editing={editing}
              onPatch={(fields) => patch(selected.id, fields)}
              onUploadImage={(file) => uploadImage(selected.id, file)}
              onDelete={() => removeMember(selected.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamDetail({ member, editing, onPatch, onUploadImage, onDelete }) {
  return (
    <div>
      <div className="aspect-square bg-black/5 overflow-hidden relative max-w-xs mx-auto mt-6">
        {member.image_url ? (
          <img src={member.image_url} alt={member.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-black/30 text-xs">No image</div>
        )}
        {editing && (
          <label className="absolute bottom-2 right-2 btn-outline-dark text-xs bg-white cursor-pointer" data-testid="team-image-upload">
            <Upload size={12} /> Replace
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); }} />
          </label>
        )}
      </div>

      <div className="p-6 text-center">
        <DialogTitle className="sr-only">{member.name || "Team member details"}</DialogTitle>
        <Editable
          as="h2"
          value={member.name}
          onSave={(v) => onPatch({ name: v })}
          className="font-serif font-black text-2xl block"
          testId="team-detail-name"
        />
        <div className="mt-2 text-[11px] tracking-[0.2em] uppercase font-bold text-[var(--scale-crimson)]">
          <Editable value={member.designation} onSave={(v) => onPatch({ designation: v })} placeholder="Designation" testId="team-detail-designation" />
        </div>
        <Editable
          as="p"
          value={member.bio}
          onSave={(v) => onPatch({ bio: v })}
          multiline
          className="mt-4 text-sm text-black/75 leading-relaxed block text-left"
          placeholder="Short bio…"
          testId="team-detail-bio"
        />

        {editing && (
          <button
            onClick={onDelete}
            className="mt-6 text-xs text-black/40 hover:text-[var(--scale-crimson)] flex items-center gap-1.5 mx-auto"
            data-testid="team-delete-btn"
          >
            <Trash2 size={12} /> Remove this member
          </button>
        )}
      </div>
    </div>
  );
}
