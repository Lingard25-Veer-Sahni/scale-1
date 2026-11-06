import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Navigate } from "react-router-dom";
import { coursesApi, learnersApi, learnerApi } from "../lib/api";
import { getLearner, clearLearner } from "../lib/learner";
import LearnerSignupGate from "../components/LearnerSignupGate";
import { Button } from "../components/ui/button";
import { CheckCircle2, Circle, FileText, Presentation, Download, LogOut, Award } from "lucide-react";
import { toast } from "sonner";

function youtubeEmbedUrl(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/);
  const id = m ? m[1] : null;
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

export default function CourseLearnPage() {
  const { slug } = useParams();
  const [learner, setLearnerState] = useState(getLearner());
  const [course, setCourse] = useState(null);
  const [progress, setProgress] = useState({});
  const [completedAt, setCompletedAt] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const loadCourse = useCallback(async () => {
    try {
      const c = await coursesApi.get(slug);
      setCourse(c);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadProgress = useCallback(async () => {
    if (!getLearner()) return;
    try {
      const p = await coursesApi.progress(slug);
      setProgress(p.progress || {});
      setCompletedAt(p.completed_at || null);
    } catch {
      // learner token invalid/expired — drop back to signup gate
      clearLearner();
      setLearnerState(null);
    }
  }, [slug]);

  useEffect(() => { loadCourse(); }, [loadCourse]);
  useEffect(() => { if (learner) loadProgress(); }, [learner, loadProgress]);

  if (notFound) return <Navigate to="/courses" replace />;

  const lessons = course?.lessons || [];
  const lesson = lessons[activeIdx];
  const allPassed = lessons.length > 0 && lessons.every((l) => progress[l.id]?.passed);

  const downloadCertificate = async () => {
    try {
      const res = await learnerApi.get(`/courses/${slug}/certificate`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `SCALE-Certificate-${(learner?.name || "certificate").replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't generate certificate — make sure you've passed every lesson's quiz.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--scale-offwhite)] pt-20" data-testid="course-learn-page">
      <LearnerSignupGate
        open={!learner}
        courseTitle={course?.title}
        onSuccess={(l) => setLearnerState({ ...l })}
      />

      <section className="dark-red-section py-8 md:py-10">
        <div className="max-container flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="eyebrow-gold">{course?.title || "Loading…"}</div>
            <div className="text-white/70 text-sm mt-1">
              {learner ? `Signed in as ${learner.name}` : ""}
            </div>
          </div>
          {learner && (
            <button
              onClick={() => { clearLearner(); setLearnerState(null); }}
              className="text-white/70 hover:text-white text-xs flex items-center gap-1.5"
              data-testid="learner-logout"
            >
              <LogOut size={12} /> Not you? Sign out
            </button>
          )}
        </div>
      </section>

      {loading ? (
        <div className="max-container py-16 text-black/50">Loading course…</div>
      ) : (
        <div className="max-container py-8 md:py-12 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
          <aside className="lg:sticky lg:top-24 h-fit">
            {allPassed && (
              <div className="mb-4 p-4 border-2 border-[var(--scale-gold)] bg-white" data-testid="certificate-ready">
                <div className="flex items-center gap-2 font-bold text-sm mb-2">
                  <Award size={16} className="text-[var(--scale-gold)]" /> Certificate unlocked!
                </div>
                <Button onClick={downloadCertificate} className="btn-gold w-full text-xs" data-testid="download-certificate-btn">
                  <Download size={14} /> Download certificate
                </Button>
              </div>
            )}
            <div className="border border-black/15 bg-white">
              {lessons.map((l, i) => {
                const p = progress[l.id];
                return (
                  <button
                    key={l.id}
                    onClick={() => setActiveIdx(i)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-black/10 last:border-b-0 text-sm ${
                      i === activeIdx ? "bg-[var(--scale-crimson)]/5" : "hover:bg-black/[0.03]"
                    }`}
                    data-testid={`lesson-nav-${i}`}
                  >
                    {p?.passed ? (
                      <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
                    ) : (
                      <Circle size={16} className="text-black/25 shrink-0 mt-0.5" />
                    )}
                    <span>
                      <span className="block text-[10px] uppercase tracking-wider text-black/40">Lesson {l.order}</span>
                      <span className="font-medium">{l.title}</span>
                      {p && !p.passed && (
                        <span className="block text-[11px] text-black/40 mt-0.5">Best: {p.best_score_pct}%</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main>
            {lesson ? (
              <LessonView
                key={lesson.id}
                lesson={lesson}
                progress={progress[lesson.id]}
                onPassed={loadProgress}
                onNext={() => setActiveIdx((i) => Math.min(lessons.length - 1, i + 1))}
                hasNext={activeIdx < lessons.length - 1}
              />
            ) : (
              <div className="text-black/50">This course has no lessons yet.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function LessonView({ lesson, progress, onPassed, onNext, hasNext }) {
  const embedUrl = useMemo(() => youtubeEmbedUrl(lesson.youtube_url), [lesson.youtube_url]);
  const [showQuiz, setShowQuiz] = useState(false);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setShowQuiz(false);
    setAnswers({});
    setResult(null);
  }, [lesson.id]);

  const quiz = lesson.quiz || [];
  const allAnswered = quiz.length > 0 && quiz.every((q) => answers[q.id] !== undefined);

  const submitQuiz = async () => {
    setSubmitting(true);
    try {
      const orderedAnswers = quiz.map((q) => answers[q.id]);
      const res = await learnersApi.submitQuiz(lesson.id, orderedAnswers);
      setResult(res);
      if (res.passed) {
        toast.success(`Passed with ${res.score_pct}%!`);
        onPassed();
      } else {
        toast.error(`${res.score_pct}% — need ${res.passing_pct}%+ to pass. Try again.`);
      }
    } catch {
      toast.error("Couldn't submit quiz. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const retake = () => {
    setResult(null);
    setAnswers({});
  };

  return (
    <div className="border border-black/15 bg-white p-6 md:p-8" data-testid={`lesson-view-${lesson.order}`}>
      <div className="text-[10px] uppercase tracking-wider text-black/40 mb-1">Lesson {lesson.order}</div>
      <h1 className="font-serif font-black text-2xl md:text-3xl mb-5">{lesson.title}</h1>

      {embedUrl && (
        <div className="aspect-video w-full mb-6 bg-black">
          <iframe
            className="w-full h-full"
            src={embedUrl}
            title={lesson.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-8">
        {lesson.summary_pdf_id && (
          <a
            href={`${process.env.REACT_APP_BACKEND_URL}/api/course-materials/${lesson.summary_pdf_id}`}
            target="_blank"
            rel="noreferrer"
            className="btn-outline-dark text-xs"
            data-testid="lesson-summary-link"
          >
            <FileText size={14} /> Lesson summary (PDF)
          </a>
        )}
        {lesson.ppt_pdf_id && (
          <a
            href={`${process.env.REACT_APP_BACKEND_URL}/api/course-materials/${lesson.ppt_pdf_id}`}
            target="_blank"
            rel="noreferrer"
            className="btn-outline-dark text-xs"
            data-testid="lesson-ppt-link"
          >
            <Presentation size={14} /> Slides (PDF)
          </a>
        )}
      </div>

      {quiz.length === 0 ? (
        hasNext && (
          <Button onClick={onNext} className="btn-gold" data-testid="lesson-next-btn">Next lesson</Button>
        )
      ) : !showQuiz ? (
        <Button onClick={() => setShowQuiz(true)} className="btn-gold" data-testid="start-quiz-btn">
          {progress?.passed ? "Retake quiz" : "Take the quiz"}
        </Button>
      ) : (
        <div className="border-t border-black/10 pt-6" data-testid="quiz-section">
          <h2 className="font-serif font-black text-xl mb-4">Lesson {lesson.order} Quiz</h2>
          {quiz.map((q, qi) => (
            <div key={q.id} className="mb-5">
              <div className="font-medium mb-2 text-sm">{qi + 1}. {q.question}</div>
              <div className="flex flex-col gap-2">
                {q.options.map((opt, oi) => {
                  const selected = answers[q.id] === oi;
                  const showFeedback = !!result;
                  const isCorrectAns = result && result.correct_indices[qi] === oi;
                  const isWrongSelected = showFeedback && selected && !result.correct_flags[qi];
                  return (
                    <label
                      key={oi}
                      className={`flex items-center gap-2 px-3 py-2 border text-sm cursor-pointer ${
                        selected ? "border-[var(--scale-crimson)] bg-[var(--scale-crimson)]/5" : "border-black/15"
                      } ${showFeedback && isCorrectAns ? "border-green-600 bg-green-50" : ""} ${
                        isWrongSelected ? "border-red-500 bg-red-50" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        disabled={!!result}
                        checked={selected}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
              {result && result.explanations?.[qi] && (
                <div className="text-xs text-black/50 mt-1.5">{result.explanations[qi]}</div>
              )}
            </div>
          ))}

          {!result ? (
            <Button
              onClick={submitQuiz}
              disabled={!allAnswered || submitting}
              className="btn-gold"
              data-testid="submit-quiz-btn"
            >
              {submitting ? "Submitting…" : "Submit quiz"}
            </Button>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <div className={`font-bold ${result.passed ? "text-green-700" : "text-red-600"}`}>
                {result.score_pct}% ({result.num_correct}/{result.num_questions}) — {result.passed ? "Passed" : `Need ${result.passing_pct}%+`}
              </div>
              {!result.passed && (
                <Button onClick={retake} variant="outline" data-testid="retake-quiz-btn">Try again</Button>
              )}
              {result.passed && hasNext && (
                <Button onClick={onNext} className="btn-gold" data-testid="lesson-next-btn">Next lesson</Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
