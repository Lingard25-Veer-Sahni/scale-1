import React from "react";
import Hero from "../components/Hero";
import FieldsStrip from "../components/FieldsStrip";
import Pillars from "../components/Pillars";
import WhatIsScale from "../components/WhatIsScale";
import EventsSection from "../components/EventsSection";
import UpcomingBanner from "../components/UpcomingBanner";
import ContactSection from "../components/ContactSection";
import { useApp } from "../context/AppContext";

export default function HomePage() {
  const { loading, content, loadError, retryLoad } = useApp();

  if (loading || !content) {
    // Real text, not a bare "Loading…": the first thing a visitor (or a
    // crawler that stops before the data arrives) sees should still say who
    // SCALE is and link somewhere useful. Facts only, no claims.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--scale-darkred)] text-white text-center px-6">
        <h1 className="font-serif text-2xl md:text-3xl">SCALE</h1>
        <p className="text-sm md:text-base text-white/80 max-w-xl">
          Society of Commerce, Analytics, Leadership and Entrepreneurship. SCALE runs business
          case competitions, expert sessions and free online courses for school students in India.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-5 text-sm">
          <a href="/courses" className="underline underline-offset-4">
            Free courses
          </a>
          <a href="mailto:scalesupportteam2@gmail.com" className="underline underline-offset-4">
            scalesupportteam2@gmail.com
          </a>
        </nav>
        <div className="font-serif text-sm text-white/60" data-testid="home-loading-status">
          {loadError ? "Having trouble reaching the server…" : "Loading…"}
        </div>
        {loadError && (
          <>
            <div className="text-sm text-white/70 max-w-md">
              {loadError === "timeout"
                ? "The server may be waking up from idle — this can take up to a minute on the first request."
                : "Something went wrong loading the site."}{" "}
              Retrying automatically…
            </div>
            <button
              onClick={retryLoad}
              className="btn-outline-light mt-2"
              data-testid="home-retry-btn"
            >
              Retry now
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div data-testid="home-page">
      <Hero />
      <FieldsStrip />
      <Pillars />
      <UpcomingBanner />
      <WhatIsScale />
      <EventsSection />
      <ContactSection />
    </div>
  );
}
