import React, { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { learnersApi } from "../lib/api";
import { setLearner } from "../lib/learner";
import { toast } from "sonner";

/**
 * Coursera-style gate: a visitor can only start/continue a course after
 * signing up with name + email. Re-entering an email that's already signed
 * up just logs them back in (backend upserts by email), so this doubles as
 * a lightweight "login" for returning learners.
 */
export default function LearnerSignupGate({ open, onSuccess, courseTitle }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Please enter your name and email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await learnersApi.signup(name.trim(), email.trim());
      setLearner({ token: res.token, name: res.learner.name, email: res.learner.email });
      toast.success(`Welcome, ${res.learner.name}!`);
      onSuccess(res.learner);
    } catch {
      toast.error("Signup failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm" data-testid="learner-signup-dialog">
        <DialogTitle className="font-serif font-black text-xl">Sign up to start learning</DialogTitle>
        <p className="text-sm text-black/60 -mt-2">
          {courseTitle ? `Enter your name and email to start "${courseTitle}".` : "Enter your name and email to continue."}
          {" "}It's free — this just lets us track your progress and issue your certificate.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3 mt-2">
          <Input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="learner-signup-name"
            autoFocus
          />
          <Input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="learner-signup-email"
          />
          <Button type="submit" disabled={submitting} data-testid="learner-signup-submit" className="btn-gold">
            {submitting ? "Starting…" : "Start learning"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
