# Assessment B — Impeccable 4.3.1 detector + browser evidence

This is the isolated Assessment B record. It does not contain or rely on Assessment A or earlier critique outputs.

## Provenance and execution

- Assessor: `/root/impeccable431_evidence_review`.
- Date: 2026-09-21. Browser log timestamps observed from approximately 13:02–13:07 UTC.
- Target: `src/components/product/ProductShowcase.vue`; supporting product, layout, and Three scene UI.
- Resolved target slug: `src-components-product-productshowcase-vue`.
- Context loaded once using `C:/Users/WindGear/.codex/skills/impeccable/scripts/impeccable.cmd context --target src/components/product/ProductShowcase.vue`. The installed `SKILL.md` declares version 4.3.1.
- Read `.ai/project.md`, `.ai/architecture.md`, current PRODUCT/DESIGN context, SKILL.md and Assessment B/browser requirements in `reference/critique.md`.
- `.impeccable/critique/ignore.md` was absent. No old detector result, prior critique report, or Assessment A output was read.
- Read-only source review. No source modifications, no new server, no test/build runs. Existing production preview at `http://127.0.0.1:5181/` was left running.

## CLI detector result

Executed exactly once:

```text
C:/Users/WindGear/.codex/skills/impeccable/scripts/impeccable.cmd detect --json src/components/product src/components/layout src/components/three
```

- Exit status: **0**.
- Findings JSON: **[]**.
- Finding count: **0**. Rule names and file locations: none returned.
- JSON saved verbatim in `.impeccable/critique/assessment-b-431.detector.json` (UTF-8).
- The CLI output does not report a scanned-file count. Do not infer broad accessibility compliance or runtime correctness from the empty mechanical result.
- False positives: none to adjudicate because no findings were returned.

## Browser method and limitations

- Created an independent, hidden Codex in-app browser tab using `cua.createBrowserTab("iab", "http://127.0.0.1:5181/", { visible: false })`. Assessment B tab ID was `1`; existing user tabs were not reused.
- Used native `mcp__cua_repl` accessibility snapshots/screenshots, its documented semantic Playwright controls, and read-only DOM evaluation. No custom Playwright/Puppeteer process was used.
- Tested explicit viewport overrides 1280×720, 1440×1000, and 390×844. The 390px check is compatibility evidence, not a mobile product redesign brief.
- **No reliable visible overlay is available.** The browser API explicitly documents `playwright.evaluate` as a read-only page scope; the selected native API does not provide mutable script injection. Therefore title mutation / appended-script preflight was unavailable and was not attempted through another channel. No CDP, shell, clipboard, or alternate injection workaround was used.
- Accordingly, no Impeccable live-server was started, no `[Human]` overlay was presented, no `detect.js` was injected, and there are no in-page Impeccable console findings. Browser visibility remained false.
- Fallback evidence is the native screenshots, AX trees, DOM attributes/bounds, and native tab developer logs described below. Screenshots were emitted directly in Assessment B tool results; no separate screenshot file export was available through the documented native screenshot API.
- Camera permission was not requested. Live human hand tracking, comfort, success rates, and camera-session continuity are **not tested**. The visible pre-camera entry and guidance were inspected.
- No quantitative GPU performance claim, full screen-reader certification, forced network failure, or reduced-motion runtime test is made here.
- Cleanup completed: viewport override reset and Assessment B's own tab closed successfully. Port 5181 was not stopped. No temporary server or injected script required cleanup; detector JSON and this report are deliberate review artifacts.

## Evidence matrix

| Viewport | Product/state | Direct observation |
| --- | --- | --- |
| 1280×720 | FORM / 01 default | Product and identity occupy separate regions; exploration dock and view toolbar fit in the viewport. One Canvas; measured CSS bounds x=292, y=128, width≈940, height≈446. Document scrollWidth=1280. |
| 1280×720 | FORM / 01 front view + appearance | Right panel fits without covering the Canvas. Three finishes expose pressed states and a visible checkmark. Front-view button has no persistent selected semantic or class. |
| 1280×720 | FORM / 01 hand entry | Only one active right panel. Visible animated hand demonstration, explanation, skip action, enable action, and local-processing/default-off wording. |
| 1280×720 | FORM / 01 complete console | Panel independent scrolling measured clientHeight=589, scrollHeight=1809, overflowY=auto. First screen shows finish choices and parts; lower sections are reached by scrolling. |
| 1280×720 | toy-racer expanded structure | Separate body and front wheels are visible; panel says this is exterior layering, not internal construction. A persistent outside-panel return action is present. |
| 1280×720 | potted-plant default | Botanical background and natural pot/foliage are distinct from metal/racer stages. No luminous surrounding ring. Layout does not overflow horizontally. |
| 1440×1000 | FORM / 01 default | Large silver product remains the dominant central artifact; left identity and bottom tools remain readable and separate. One Canvas; document scrollWidth=1440. |
| 1440×1000 | toy-racer default and left-front-wheel focus | Warm pedestal stage. The selected wheel hotspot, matching selected part button, explanatory text, and return action appear together. |
| 1440×1000 | potted-plant default/loading | The initial AX snapshot reports “正在准备你的观察视角…” with model actions disabled; the subsequent native screenshot shows the plant, and later AX confirms controls enabled. No load timing inferred. |
| 1440×1000 | catalog | Three featured items visibly lead the catalog: speaker, racer, plant. Current product has “正在展示” and pressed state. Choosing an item closes the catalog and focuses its heading. |
| 390×844 | potted-plant default | Single-column sequence is identity → model → view toolbar → dock. Browser innerWidth=390, document scrollWidth=375 (scrollbar occupies remaining width), so no horizontal overflow was observed. Document height was 850. |
| 390×844 | hand panel | Panel is below the scene and scrolls into view; controls remain usable. No horizontal clipping observed. Escape closes it and focuses the hand opener. |
| 390×844 | catalog no results | Search “不存在的展品431” produces “0 件作品”, “还没有找到这件物品。” and “查看全部商品”. Recovery restores seven items. Search and recovery fit horizontally. |

## Reproducible issues and interpretation

### B1 — P2: view presets do not expose the current view

1. At 1280×720, click `正面`.
2. The model changes to a front-facing view.
3. AX continues to list three ordinary buttons: 立体 / 正面 / 背面. Read-only DOM inspection returns `aria-pressed=null`, `aria-current=null`, and exactly the same class string for all three buttons.

The view changes but the toolbar does not retain a selected-view marker. A keyboard or screen-reader user cannot inspect which preset is current; a sighted user must infer it from the model. This is distinct from finish/part/dock controls, which do expose their selection.

Source: `src/components/product/ViewerControls.vue:35`–44 constructs the presets without binding to `store.viewPreset`. Add one clear selected treatment and state semantics, while representing manual/free camera movement honestly.

### B2 — P2: the outside-panel “返回全景” action removes its own focused element

1. Open toy-racer details, select `了解左前轮`, then close the panel.
2. Activate the remaining outside-panel `返回全景` button.
3. The action disappears. Native AX reports the focused element as the root WebArea, rather than a surviving control.
4. The same root-focus result occurred after returning from expanded structure.

The return operation itself works, but keyboard continuity is lost at its end. Move focus to a stable, nearby exploration or view control after the conditional return control is removed.

Source: `src/components/product/ExperienceDock.vue:17`–21 and 25–30. The overview action clears the exact condition that renders its button and has no surviving focus destination.

Related minor observation: open hand panel → click top `完整控制台` → close it. Focus returns to the original `手势` opener, not the most recent console opener. `StudioControls.vue:29`–30 records an opener only when the previous panel was empty. This may be intentional for a continuous sidebar session, but it is not the latest triggering control.

### B3 — P2 visual hierarchy: the hand-start action is less prominent than the skip action

At both 1280×720 and 390×844, the hand introduction presents `跳过动作示范` as bright text, then `开启手势体验` as a small, muted rectangle beneath it. Native DOM confirmed the start button is **enabled**, not disabled:

- Start: 105×38 CSS px, foreground rgb(175,185,200), translucent dark background.
- Skip: 116×36 CSS px, foreground rgb(244,247,251), transparent background.

The next step for entering the feature is visually weaker than bypassing its demonstration. Give the enabled start action the local primary emphasis. This is a visual hierarchy finding, not a measured contrast failure or proof that users cannot find it.

Source: `src/components/product/GesturePanel.vue:73`–78 and `src/components/product/GestureOnboarding.vue:79`; shared styles in `src/assets/styles/gesture.css:13`.

### B4 — P2 consistency candidate: catalog order and previous/next order differ

The catalog leads with speaker → racer → plant. However, from speaker, `下一件商品` navigates to `gamepad` and displays 02/07. Racer selected from the catalog displays 07/07; plant displays 05/07. This is directly reproducible and confirmed in source: catalog sorts by featuredRank, while the switcher indexes raw collection order.

If the three curated exhibits are intended to form the primary walkthrough, align the navigation sequence with that curated order or explain the distinction. The differing order does not prevent access; catalog selection works. Treat priority as contingent on the intended guided walkthrough, rather than as a rendering failure.

Source: `src/components/product/ProductCollection.vue:22`; `src/components/product/ProductSwitcher.vue:7`–9.

## Confirmed positive behavior

- Dock buttons expose both expanded and pressed states; appearance and part selections expose pressed states. Selecting graphite updates the visible finish status and Canvas accessible description. Escape closes the appearance panel and restores its opener; the selected finish remains graphite.
- Closing details retains the selected part and the outside-panel return action. Returning restores complete appearance. Expanding structure updates the accessible model description to “当前外观结构展开” and changes the action to “合拢结构”.
- Product selection closes the modal and moves focus to the product H1. The catalog current card is visibly and semantically selected. Search has an accessible label and actionable empty state.
- Pre-camera hand entry states that camera is off by default and processing is local. Demonstration is skippable and enabling is explicit. No camera access was triggered by opening the sidebar.
- Main icon-only controls have accessible labels, including product previous/next, zoom, reset, panel close, and hotspot. Native keyboard focus was visibly outlined on the mobile search field.
- Three distinct stage treatments are actually visible: cold reflective metal, warm racer/pedestal, and botanical foliage. The UI recedes on the default desktop surface and uses one visible active sidebar.

## Smaller observations / boundaries

- At 390px, toolbar zoom/reset targets measure 36×40 CSS px; previous/next targets are 35×44; panel close is 36×36. These are below a 44×44 comfort target, but this record does **not** claim that fact alone violates WCAG 2.2 AA's 24px target criterion. Mobile is secondary compatibility scope.
- Mobile retains mouse-oriented copy “拖动旋转 · 滚轮缩放” and “随时移动鼠标即可接管”; input-specific wording could be clearer on a touch device. The 390px viewport override alone does not emulate a physical touchscreen.
- The first fresh root URL reported the document title `Trees X — FORM / 01 交互工作台`; switching products updated it to the selected Chinese item name plus Trees X. This is a small naming inconsistency with the new exhibition experience.
- Native error/warning log query returned **no error entries** and six warning entries: one PCFSoftShadowMap deprecation, five repeated DRACOLoader setDecoderConfig deprecations across product loads. These are maintenance signals, not established visual defects or a failed model load.
- A default DOM query found one Canvas and status regions for finish and camera-default wording. Hidden status regions were not treated as announced content; no full screen-reader session was performed.
- No P0/P1 blocker was demonstrated in the sampled browser flows. Mechanical detector cleanliness does not remove the state/focus/hierarchy issues above.

Assessment B is complete. Findings are held in this artifact for synthesis only after Assessment A is complete.
