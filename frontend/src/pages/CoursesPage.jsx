import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { coursesApi } from "../lib/api";
import Editable from "../components/Editable";
import { GraduationCap, ArrowRight } from "lucide-react";

export default function CoursesPage() {
  const { content, isAdmin, loading: appLoading } = useApp();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    coursesApi.list().then(setCourses).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (!appLoading && content && content.courses_page_visible === false && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-[var(--scale-offwhite)] pt-20" data-testid="courses-page">
      <section className="dark-red-section py-12 md:py-20">
        <div className="max-container">
          <Editable as="div" field="courses_eyebrow" value={content?.courses_eyebrow} className="eyebrow-gold block" />
          <Editable
            as="h1"
            field="courses_headline"
            value={content?.courses_headline}
            multiline
            className="font-serif font-black text-4xl md:text-6xl text-white leading-[1.05] block mt-2"
          />
          <Editable
            as="p"
            field="courses_about"
            value={content?.courses_about}
            multiline
            className="mt-6 max-w-2xl text-white/80 leading-relaxed block"
          />
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="max-container">
          <h2 className="font-serif font-black text-2xl md:text-3xl mb-8">Available Courses</h2>

          {loading ? (
            <div className="text-black/50">Loading…</div>
          ) : courses.length === 0 ? (
            <div className="text-black/50 border border-dashed border-black/15 p-10 text-center">
              No courses published yet. Check back soon.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {courses.map((c) => (
                <Link
                  key={c.id}
                  to={`/courses/${c.slug}`}
                  className="group block border border-black/15 bg-white p-6 md:p-8 hover:border-[var(--scale-crimson)] transition-colors"
                  data-testid={`course-card-${c.slug}`}
                >
                  <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase font-bold text-[var(--scale-crimson)] mb-3">
                    <GraduationCap size={14} /> Free Course
                  </div>
                  <h3 className="font-serif font-black text-2xl mb-3">{c.title}</h3>
                  <p className="text-sm text-black/70 leading-relaxed mb-6">{c.description}</p>
                  <div className="inline-flex items-center gap-1.5 text-sm font-bold group-hover:gap-2.5 transition-all">
                    Start course <ArrowRight size={14} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
