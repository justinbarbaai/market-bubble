"use client";

import { TermShell } from "../components/TermShell";
import { ClipBoard } from "../components/ClipBoard";

export default function ClipsPage() {
  return (
    <TermShell>
      <section className="mb-section-head">
        <h1 className="mb-page-title">Clip-to-Earn</h1>
        <p className="mb-page-sub">Turn the show into reach — clip it, post it, earn Bubbles</p>
      </section>
      <ClipBoard />
    </TermShell>
  );
}
