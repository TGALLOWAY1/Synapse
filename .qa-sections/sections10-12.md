# Synapse QA Testing Guide — Sections 10-12

---

## Section 10: Bug Report Template

Copy and paste the template below for each bug found during testing.

```markdown
### Bug Report

- **Bug ID:** BUG-___
- **Title:** [Short description of the issue]
- **Severity:** [ ] Critical / [ ] High / [ ] Medium / [ ] Low
- **Area:** [ ] HomePage / [ ] PRD / [ ] Branches / [ ] Mockups / [ ] Artifacts / [ ] Markup Images / [ ] Export / [ ] Settings / [ ] History / [ ] Persistence / [ ] Mobile

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**


**Actual Result:**


**Screenshots/Recordings:**
[Attach or link if applicable]

**Browser / Device:**
- Browser:
- Version:
- OS:
- Device (if mobile):

**Console Errors (if any):**
```
[Paste any console errors here]
```

**localStorage state relevant?** [ ] Yes / [ ] No
- If yes, describe:

**Reproducibility:** [ ] Always / [ ] Sometimes / [ ] Once

**Notes:**

```

---

## Section 11: Tester Feedback Template

Use this template to collect feedback from non-technical testers after they complete a testing session.

```markdown
### Tester Feedback Form

- **Tester Name:**
- **Date:**
- **Task Attempted:** [e.g., "Create a new project and generate a PRD"]

**Were you able to complete it?** [ ] Yes / [ ] Partially / [ ] No

**What was confusing?**


**What broke or didn't work?**


**What did you like?**


**How would you rate the experience?** [ ] 1 / [ ] 2 / [ ] 3 / [ ] 4 / [ ] 5
_(1 = very frustrating, 5 = smooth and enjoyable)_

**Would you use this tool again?** [ ] Yes / [ ] Maybe / [ ] No

**Any other thoughts?**

```

---

## Section 12: Recommended Next Steps

A prioritized action plan based on the QA analysis of Synapse.

### 1. Immediate (before sharing with users)

- Run the 30-minute smoke test (Section 5) end to end and document any failures.
- Fix any critical bugs found during the smoke test before proceeding.
- Verify the API key flow works correctly: entering a key, persisting it in localStorage, and using it for generation calls to Gemini.

### 2. Short-term (first week)

- Run the full manual QA test plan (Sections 3-8) across Chrome, Firefox, and Safari.
- Conduct 3-5 user verification sessions using the Tester Feedback Template (Section 11) with people unfamiliar with the app.
- Set up a Playwright config and write the first 5 automated smoke tests covering: app load, project creation, PRD generation trigger, navigation between sections, and export.
- Add a confirmation dialog for project deletion to prevent accidental data loss.

### 3. Medium-term (first month)

- Add unit tests for the Zustand store — this is the highest-ROI testing investment since the store manages all application state and persistence.
- Add integration tests for generation workflows (PRD, mockups, artifacts) to catch regressions in the AI pipeline.
- Add visual regression tests for SVG renderers used in mockups and markup images.
- Implement localStorage quota detection and warnings so users are alerted before they hit browser storage limits.
- Add error boundaries around generation components to prevent a single failed generation from crashing the entire app.

### 4. Longer-term

- Consider backend persistence (Supabase or Firebase) for data safety — localStorage-only storage is the single biggest risk to user trust.
- Add undo/redo support for editing PRDs, mockups, and artifacts.
- Add unsaved changes detection with a prompt before navigating away or closing the tab.
- Add collaborative features so multiple users can work on the same project.
- Expand automated test coverage to 70%+ across unit, integration, and end-to-end tests.
