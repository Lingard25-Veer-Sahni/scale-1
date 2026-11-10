import React from "react";
import { LOGO_URL } from "../lib/brand";

export default function Footer() {
  return (
    <footer className="footer-black" data-testid="footer">
      <div className="max-container py-10 md:py-12 grid grid-cols-1 md:grid-cols-3 items-center gap-6">
        <div className="flex items-center gap-3 justify-center md:justify-start">
          <img src={LOGO_URL} alt="SCALE" className="h-10 w-auto rounded-sm" />
          <span className="font-serif font-bold text-white text-xl">SCALE</span>
        </div>
        {/* The footer no longer carries a tagline. The middle column is kept
            so the logo stays left and the copyright stays right in the
            three-column grid. The footer_tagline field remains on the content
            model so older saved rows stay valid, but nothing renders it. */}
        <div className="text-center" aria-hidden="true" />
        <div className="text-center md:text-right text-xs text-white/60 tracking-wider uppercase">
          © {new Date().getFullYear()} SCALE India · All rights reserved
        </div>
      </div>
    </footer>
  );
}
