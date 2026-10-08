import React, { useState } from "react";

/**
 * <img> that falls back to a "No image" placeholder instead of the browser's
 * broken-image/question-mark icon when the src 404s/503s. Needed because a
 * chunk of uploaded community/team photos were lost when local-disk storage
 * on Render got wiped on redeploy (fixed going forward via Supabase Storage,
 * but the already-lost references still point at URLs that now 503 — this
 * keeps that failure mode from looking broken/ugly instead of fixing data
 * that can only be fixed by re-uploading the image).
 */
export default function SafeImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={`${className || ""} flex items-center justify-center text-black/30 text-xs bg-black/5`}>
        No image
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
