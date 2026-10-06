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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--scale-darkred)] text-white text-center px-6">
        <div className="font-serif text-xl">
          {loadError ? "Having trouble reaching the server…" : "Loading SCALE…"}
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
