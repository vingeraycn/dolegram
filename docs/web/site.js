"use strict";

import { track } from "./analytics.js";

const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionButton = document.querySelector("#motion");
const replayButton = document.querySelector("#replay");
const answer = document.querySelector("#demo-answer");
const copyButton = document.querySelector("#copy");
const copyStatus = document.querySelector("#copy-status");
const prompt = document.querySelector("#install-prompt");
let manuallyPaused = false;
let demoTimers = [];

function finishDemo() {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
  answer.textContent = "Of course. Let’s think it through.";
  replayButton.disabled = reducedMotion.matches || manuallyPaused;
}

function updateMotion() {
  const paused = manuallyPaused || reducedMotion.matches || document.hidden;
  root.dataset.paused = String(paused);
  motionButton.setAttribute(
    "aria-pressed",
    String(manuallyPaused || reducedMotion.matches),
  );
  motionButton.setAttribute(
    "aria-label",
    reducedMotion.matches
      ? "Animation off: reduced motion enabled"
      : manuallyPaused
        ? "Resume animation"
        : "Pause animation",
  );
  motionButton.title = motionButton.getAttribute("aria-label");
  motionButton.disabled = reducedMotion.matches;
  if (paused) finishDemo();
}

motionButton.hidden = false;
replayButton.hidden = false;
copyButton.hidden = false;
motionButton.addEventListener("click", () => {
  manuallyPaused = !manuallyPaused;
  updateMotion();
});
reducedMotion.addEventListener("change", updateMotion);
document.addEventListener("visibilitychange", updateMotion);
updateMotion();

replayButton.addEventListener("click", () => {
  finishDemo();
  if (reducedMotion.matches || manuallyPaused) return;
  replayButton.disabled = true;
  track("demo_replay");
  answer.textContent = "Waiting for Dot…";
  demoTimers = [
    setTimeout(() => {
      answer.textContent = "Thinking…";
    }, 650),
    setTimeout(() => {
      answer.textContent = "Of course.";
    }, 1500),
    setTimeout(finishDemo, 2800),
  ];
});

copyButton.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(prompt.value);
    track("install_prompt_copy");
    copyStatus.textContent = "Copied. Paste it into your Agent.";
    copyButton.querySelector("span").textContent = "Copied!";
  } catch {
    track("install_prompt_copy_fallback");
    copyButton.querySelector("span").textContent = "Copy install prompt";
    prompt.focus();
    prompt.select();
    copyStatus.textContent =
      "Prompt selected. Copy it, then paste it into your Agent.";
  }
});
