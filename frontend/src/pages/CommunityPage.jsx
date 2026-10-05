import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { communityApi, uploadsApi } from "../lib/api";
import Editable from "../components/Editable";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Slider } from "../components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Plus, Trash2, Upload, Users, BookOpen, User, X } from "lucide-react";
import { toast } from "sonner";

export default function CommunityPage() {
  const { content, editing, isAdmin, loading: appLoading } = useApp();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    try { setGroups(await communityApi.list()); } catch { toast.error("Failed to load community."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Admins can still reach the page (to review/un-hide it); everyone else is
  // bounced home once we know the page has been hidden via the Content tab.
  if (!appLoading && content && content.community_page_visible === false && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const selected = groups.find((g) => g.id === openId) || null;

  const patch = async (id, fields) => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...fields } : g)));
    try { await communityApi.update(id, fields); } catch { toast.error("Update failed."); }
  };

  const addGroup = async () => {
    try {
      const g = await communityApi.create({ name: "New School / NGO", type: "school", order: groups.length + 1 });
      setGroups((gs) => [...gs, g]);
      setOpenId(g.id);
      toast.success("Added. Fill in the details.");
    } catch { toast.error("Add failed."); }
  };

  const removeGroup = async (id) => {
    if (!window.confirm("Delete this school/NGO tab?")) return;
    setGroups((gs) => gs.filter((g) => g.id !== id));
    if (openId === id) setOpenId(null);
    try { await communityApi.remove(id); toast.success("Deleted."); } catch { toast.error("Delete failed."); }
  };

  const uploadMainImage = async (id, file) => {
    try {
      const res = await uploadsApi.image(file);
      await patch(id, { image_url: uploadsApi.imageUrl(res.id) });
    } catch { toast.error("Image upload failed."); }
  };

  const addGalleryImage = async (group, file) => {
    try {
      const res = await uploadsApi.image(file);
      const gallery = [...(group.gallery || []), { id: res.id, url: uploadsApi.imageUrl(res.id), caption: "" }];
      await patch(group.id, { gallery });
    } catch { toast.error("Image upload failed."); }
  };

  const removeGalleryImage = async (group, imgId) => {
    const gallery = (group.gallery || []).filter((im) => im.id !== imgId);
    await patch(group.id, { gallery });
  };

  return (
    <div className="min-h-screen bg-[var(--scale-offwhite)] pt-20" data-testid="community-page">
      <section className="dark-red-section py-12 md:py-20">
        <div className="max-container">
          <Editable as="div" field="community_eyebrow" value={content?.community_eyebrow} className="eyebrow-gold block" />
          <Editable
            as="h1"
            field="community_headline"
            value={content?.community_headline}
            multiline
            className="font-serif font-black text-4xl md:text-6xl text-white leading-[1.05] block mt-2"
          />
          <Editable
            as="p"
            field="community_about"
            value={content?.community_about}
            multiline
            className="mt-6 max-w-2xl text-white/80 leading-relaxed block"
          />
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="max-container">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
            <h2 className="font-serif font-black text-2xl md:text-3xl">Schools &amp; NGOs</h2>
            {editing && (
              <button onClick={addGroup} className="btn-outline-dark text-xs" data-testid="add-community-group">
                <Plus size={14} /> Add school / NGO
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-black/50">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="text-black/50 border border-dashed border-black/15 p-10 text-center">
              No schools or NGOs added yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="relative border border-black/15 bg-white cursor-pointer hover:border-[var(--scale-crimson)] transition-colors"
                  data-testid={`community-card-${g.id}`}
                  onClick={() => setOpenId(g.id)}
                >
                  {editing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeGroup(g.id); }}
                      className="absolute top-2 right-2 z-10 bg-black/70 text-white p-1 rounded-full"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <div className="aspect-[4/3] bg-black/5 overflow-hidden">
                    {g.image_url ? (
                      <img src={g.image_url} alt={g.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-black/30 text-xs">No image</div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="inline-block text-[10px] tracking-[0.2em] uppercase font-bold text-[var(--scale-crimson)] mb-1">
                      {g.type === "ngo" ? "NGO" : "School"}
                    </div>
                    <h3 className="font-serif font-black text-lg mb-2" data-testid={`community-name-${g.id}`}>{g.name || "Untitled"}</h3>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="bg-[var(--scale-cream)] px-2 py-1 flex items-center gap-1"><Users size={11} /> {g.attendance_count || 0}</span>
                      {g.subject && <span className="bg-[var(--scale-cream)] px-2 py-1 flex items-center gap-1"><BookOpen size={11} /> {g.subject}</span>}
                      {g.mentor_name && <span className="bg-[var(--scale-cream)] px-2 py-1 flex items-center gap-1"><User size={11} /> {g.mentor_name}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0" data-testid="community-detail-dialog">
          {selected && (
            <CommunityDetail
              group={selected}
              editing={editing}
              onPatch={(fields) => patch(selected.id, fields)}
              onUploadImage={(file) => uploadMainImage(selected.id, file)}
              onAddGalleryImage={(file) => addGalleryImage(selected, file)}
              onRemoveGalleryImage={(imgId) => removeGalleryImage(selected, imgId)}
              onDelete={() => removeGroup(selected.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommunityDetail({ group, editing, onPatch, onUploadImage, onAddGalleryImage, onRemoveGalleryImage, onDelete }) {
  return (
    <div>
      <div className="aspect-[16/9] bg-black/5 overflow-hidden relative">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-black/30 text-xs">No image</div>
        )}
        {editing && (
          <label className="absolute bottom-3 right-3 btn-outline-dark text-xs bg-white cursor-pointer" data-testid="community-image-upload">
            <Upload size={12} /> Replace image
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); }} />
          </label>
        )}
      </div>

      <div className="p-6">
        <DialogTitle className="sr-only">{group.name || "School / NGO details"}</DialogTitle>
        <Editable
          as="h2"
          value={group.name}
          onSave={(v) => onPatch({ name: v })}
          className="font-serif font-black text-2xl md:text-3xl block"
          testId="community-detail-name"
        />

        {editing ? (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-black/50">Type</span>
              <Select value={group.type} onValueChange={(v) => onPatch({ type: v })}>
                <SelectTrigger data-testid="community-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="school">School</SelectItem>
                  <SelectItem value="ngo">NGO</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-black/50">Attendance count</span>
              <input
                type="number"
                defaultValue={group.attendance_count || 0}
                onBlur={(e) => onPatch({ attendance_count: parseInt(e.target.value || "0", 10) })}
                className="border border-black/15 px-2 py-1.5"
                data-testid="community-attendance-input"
              />
            </label>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="bg-[var(--scale-cream)] px-2.5 py-1.5 flex items-center gap-1.5"><Users size={12} /> {group.attendance_count || 0} students</span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-black/50 block mb-1">Subject</span>
            <Editable value={group.subject} onSave={(v) => onPatch({ subject: v })} placeholder="Subject" testId="community-subject" />
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-black/50 block mb-1">Mentor</span>
            <Editable value={group.mentor_name} onSave={(v) => onPatch({ mentor_name: v })} placeholder="Mentor name" testId="community-mentor" />
          </div>
        </div>

        {(group.show_para || editing) && (
          <div className="mt-6 pt-6 border-t border-black/10">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow">Additional info</span>
              {editing && (
                <button
                  onClick={() => onPatch({ show_para: !group.show_para })}
                  className="text-[11px] text-black/50 hover:text-[var(--scale-crimson)]"
                  data-testid="community-toggle-para"
                >
                  {group.show_para ? "Remove this section" : "Add this section"}
                </button>
              )}
            </div>
            {group.show_para && (
              <Editable
                as="p"
                value={group.para}
                onSave={(v) => onPatch({ para: v })}
                multiline
                className="text-sm text-black/75 leading-relaxed block"
                placeholder="Add additional info…"
                testId="community-para"
              />
            )}
          </div>
        )}

        {(group.show_impact || editing) && (
          <div className="mt-6 pt-6 border-t border-black/10">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow">
                Impact{" "}
                <span className="normal-case tracking-normal font-normal text-[10px] text-black/40">
                  (percentage of students that passed the final test)
                </span>
              </span>
              {editing && (
                <button
                  onClick={() => onPatch({ show_impact: !group.show_impact })}
                  className="text-[11px] text-black/50 hover:text-[var(--scale-crimson)]"
                  data-testid="community-toggle-impact"
                >
                  {group.show_impact ? "Remove this section" : "Add this section"}
                </button>
              )}
            </div>
            {group.show_impact && (
              editing ? (
                <div data-testid="community-impact-slider">
                  <Slider value={[group.impact_percentage || 0]} max={100} step={1} onValueChange={([v]) => onPatch({ impact_percentage: v })} />
                  <div className="text-xs text-black/50 mt-2">{group.impact_percentage || 0}% impact</div>
                </div>
              ) : (
                <div>
                  <div className="h-2 bg-black/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--scale-crimson)]" style={{ width: `${group.impact_percentage || 0}%` }} />
                  </div>
                  <div className="text-xs text-black/50 mt-2">{group.impact_percentage || 0}% impact</div>
                </div>
              )
            )}
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-black/10">
          <span className="eyebrow block mb-3">Gallery</span>
          <div className="grid grid-cols-3 gap-2">
            {(group.gallery || []).map((img) => (
              <div key={img.id} className="relative aspect-square bg-black/5 overflow-hidden">
                <img src={img.url} alt={img.caption || group.name} className="w-full h-full object-cover" />
                {editing && (
                  <button
                    onClick={() => onRemoveGalleryImage(img.id)}
                    className="absolute top-1 right-1 bg-black/70 text-white p-0.5 rounded-full"
                    title="Remove"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            {editing && (
              <label
                className="aspect-square border-2 border-dashed border-[var(--scale-gold)] flex items-center justify-center cursor-pointer text-[var(--scale-crimson)]"
                data-testid="community-gallery-add"
              >
                <Plus size={16} />
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddGalleryImage(f); }} />
              </label>
            )}
          </div>
          {(!group.gallery || group.gallery.length === 0) && !editing && (
            <div className="text-xs text-black/40 mt-2">No additional images yet.</div>
          )}
        </div>

        {editing && (
          <button
            onClick={onDelete}
            className="mt-8 text-xs text-black/40 hover:text-[var(--scale-crimson)] flex items-center gap-1.5"
            data-testid="community-delete-btn"
          >
            <Trash2 size={12} /> Delete this school/NGO
          </button>
        )}
      </div>
    </div>
  );
}
